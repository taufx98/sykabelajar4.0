import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, keys.default)
const encoder = new TextEncoder()

function escapePdf(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)').replaceAll(/[^\\x20-\\x7e]/g, ' ')
}

function pdfText(text: string, x: number, y: number, size: number, bold = false) {
  return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${escapePdf(text)}) Tj ET`
}

function buildPdf(c: Record<string, unknown>) {
  const name = String(c.public_name ?? 'Peserta')
  const competition = String(c.competition_title ?? 'Kompetisi')
  const serial = String(c.serial_number ?? '')
  const code = String(c.verification_code ?? '')
  const date = c.issued_at ? new Date(String(c.issued_at)).toLocaleDateString('id-ID') : '-'
  const content = [
    '0.12 0.15 0.18 rg',
    '1 w 70 70 452 642 re S',
    pdfText('SYKABELAJAR', 190, 620, 18, true),
    pdfText('SERTIFIKAT', 185, 575, 30, true),
    pdfText('Diberikan kepada', 210, 520, 13),
    pdfText(name, Math.max(90, 306 - name.length * 5), 470, 22, true),
    pdfText('atas partisipasi pada', 210, 425, 13),
    pdfText(competition, Math.max(90, 306 - competition.length * 3), 392, 17, true),
    pdfText(`Nomor serial: ${serial}`, 110, 300, 11),
    pdfText(`Kode verifikasi: ${code}`, 110, 275, 11),
    pdfText(`Diterbitkan: ${date}`, 110, 250, 11),
    pdfText('Verifikasi: https://sykabelajar.my.id/verify/' + code, 110, 205, 9),
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 594 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(encoder.encode(pdf).length)
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = encoder.encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return encoder.encode(pdf)
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
  const code = new URL(req.url).searchParams.get('code')?.trim() ?? ''
  if (!code || code.length > 128) return new Response('Invalid verification code', { status: 400 })
  const { data: cert, error } = await supabase.rpc('get_public_collective_certificate', { p_verification_code: code })
  if (error) return new Response('Certificate lookup failed', { status: 500 })
  if (!cert) return new Response('Certificate not found', { status: 404 })
  const bytes = buildPdf(cert as Record<string, unknown>)
  const revision = 1
  const path = `collective/${String((cert as Record<string, unknown>).certificate_id)}/certificate-v${revision}.pdf`
  const { error: uploadError } = await supabase.storage.from('certificate-assets').upload(path, bytes, { contentType: 'application/pdf', cacheControl: '86400', upsert: true })
  if (uploadError) return new Response('Certificate asset generation failed', { status: 500 })
  await supabase.from('certificate_assets').upsert({ certificate_id: String((cert as Record<string, unknown>).certificate_id), asset_kind: 'PDF', storage_bucket: 'certificate-assets', storage_path: path, mime_type: 'application/pdf', revision }, { onConflict: 'certificate_id,asset_kind,revision' })
  const { data: signed, error: signedError } = await supabase.storage.from('certificate-assets').createSignedUrl(path, 300)
  if (signedError || !signed?.signedUrl) return new Response('Certificate URL generation failed', { status: 500 })
  return Response.redirect(signed.signedUrl, 302)
})
