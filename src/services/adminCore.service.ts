import { supabase } from '@/lib/supabase';

export type AdminCompetitionInput = {
  id?: string | null;
  title: string;
  slug: string;
  short_description?: string | null;
  description?: string | null;
  category?: string;
  poster_url?: string | null;
  visibility?: string;
  status?: string;
  registration_starts_at?: string | null;
  registration_ends_at?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  juknis_url?: string | null;
  kisi_kisi_published?: boolean;
  kisi_kisi_content?: string | null;
};

export type AdminPostInput = {
  id?: string | null;
  title: string;
  body: string;
  cover_url?: string | null;
  competition_id?: string | null;
  status?: string;
};

export type AdminProductInput = {
  id?: string | null;
  code: string;
  slug: string;
  name: string;
  short_description?: string | null;
  description?: string | null;
  product_type?: string;
  audiences?: string[];
  price?: number;
  currency?: string;
  image_url?: string | null;
  is_active?: boolean;
  is_featured?: boolean;
  sort_order?: number;
  metadata?: Record<string, unknown>;
};

export type CompetitionDeleteBlockers = {
  registrations: number;
  collective_registrations: number;
  attempts: number;
  collective_certificates: number;
};

function assertId(id: string) {
  if (!id) throw new Error('ID data tidak valid.');
}

export async function loadAdminCore() {
  const [stats, competitions, users, posts, orders, products] = await Promise.all([
    supabase.rpc('get_platform_stats'),
    supabase.from('competitions').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id,username,full_name,institution,avatar_url,status,account_type,created_at').order('created_at', { ascending: false }),
    supabase.from('posts').select('id,title,body,cover_url,status,competition_id,created_at,author_user_id').order('created_at', { ascending: false }),
    supabase.from('orders').select('id,user_id,status,total,payment_proof_url,payment_proof_status,created_at').order('created_at', { ascending: false }),
    supabase.from('commerce_products').select('*').order('sort_order', { ascending: true }),
  ]);

  const firstError = [stats, competitions, users, posts, orders, products].find((r) => r.error)?.error;
  if (firstError) throw firstError;

  return {
    stats: stats.data?.[0] ?? {},
    competitions: competitions.data ?? [],
    users: users.data ?? [],
    posts: posts.data ?? [],
    orders: orders.data ?? [],
    products: products.data ?? [],
  };
}

export async function saveCompetition(input: AdminCompetitionInput) {
  const { data, error } = await supabase.rpc('admin_save_competition', {
    p_competition_id: input.id ?? null,
    p_title: input.title.trim(),
    p_slug: input.slug.trim(),
    p_short_description: input.short_description ?? null,
    p_description: input.description ?? null,
    p_category: input.category ?? 'Kompetisi',
    p_poster_url: input.poster_url ?? null,
    p_visibility: input.visibility ?? 'PUBLIC',
    p_status: input.status ?? 'DRAFT',
    p_registration_starts_at: input.registration_starts_at ?? null,
    p_registration_ends_at: input.registration_ends_at ?? null,
    p_starts_at: input.starts_at ?? null,
    p_ends_at: input.ends_at ?? null,
    p_juknis_url: input.juknis_url ?? null,
    p_kisi_kisi_published: !!input.kisi_kisi_published,
    p_kisi_kisi_content: input.kisi_kisi_content ?? null,
  });
  if (error) throw error;
  return data;
}

export async function getCompetitionDeleteBlockers(id: string) {
  assertId(id);
  const { data, error } = await supabase.rpc('admin_get_competition_delete_blockers', { p_competition_id: id });
  if (error) throw error;
  return (data ?? { registrations: 0, collective_registrations: 0, attempts: 0, collective_certificates: 0 }) as CompetitionDeleteBlockers;
}

export async function deleteCompetition(id: string) {
  assertId(id);
  const { data, error } = await supabase.rpc('admin_delete_competition', { p_competition_id: id });
  if (error) throw error;
  return data;
}

export async function forceDeleteCompetition(id: string) {
  assertId(id);
  const { data, error } = await supabase.rpc('admin_force_delete_competition', {
    p_competition_id: id,
    p_reason: 'Admin panel - forced delete',
  });
  if (error) throw error;
  return data;
}

export async function savePost(input: AdminPostInput) {
  const { data, error } = await supabase.rpc('admin_save_post', {
    p_post_id: input.id ?? null,
    p_title: input.title.trim(),
    p_body: input.body,
    p_cover_url: input.cover_url ?? null,
    p_competition_id: input.competition_id ?? null,
    p_status: input.status ?? 'PUBLISHED',
  });
  if (error) throw error;
  return data;
}

export async function deletePost(id: string) {
  assertId(id);
  const { data, error } = await supabase.rpc('admin_delete_post', { p_post_id: id });
  if (error) throw error;
  return data;
}

export async function saveProduct(input: AdminProductInput) {
  const name = input.name.trim();
  const code = input.code.trim();
  const slug = input.slug.trim();
  const audiences = [...new Set((input.audiences ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))];
  const productType = String(input.product_type ?? 'DIGITAL_ITEM').trim().toUpperCase();
  const price = Number(input.price ?? 0);

  if (!name) throw new Error('Nama produk wajib diisi.');
  if (!code) throw new Error('Kode produk belum tersedia. Isi pada bagian Identitas produk atau kosongkan agar dibuat otomatis.');
  if (!slug) throw new Error('Tautan produk belum tersedia. Isi pada bagian Identitas produk atau kosongkan agar dibuat otomatis.');
  if (!['DIGITAL_ITEM', 'DONATION'].includes(productType)) throw new Error('Jenis produk ini belum didukung untuk pemesanan Shop.');
  if (!audiences.length) throw new Error('Pilih minimal satu kelompok pengguna.');
  if (audiences.some((value) => !['student', 'teacher', 'organizer'].includes(value))) throw new Error('Kelompok pengguna tidak valid.');
  if (!Number.isFinite(price) || price < 0) throw new Error('Harga harus berupa angka nol atau lebih.');
  if (input.is_active && price <= 0) throw new Error('Produk yang ditampilkan harus memiliki harga di atas Rp0.');
  const imageUrl = input.image_url?.trim() ?? '';
  if (imageUrl) {
    try {
      const url = new URL(imageUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
    } catch {
      throw new Error('Tautan gambar harus diawali http:// atau https://.');
    }
  }

  const { data, error } = await supabase.rpc('admin_save_product', {
    p_product_id: input.id ?? null,
    p_code: code,
    p_slug: slug,
    p_name: name,
    p_short_description: input.short_description?.trim() || null,
    p_description: input.description?.trim() || null,
    p_product_type: productType,
    p_audiences: audiences,
    p_price: price,
    p_currency: 'IDR',
    p_image_url: imageUrl || null,
    p_is_active: !!input.is_active,
    p_is_featured: !!input.is_featured,
    p_sort_order: Number.isInteger(input.sort_order) && Number(input.sort_order) >= 0 ? Number(input.sort_order) : 0,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    if (error.code === '23505' && error.message.includes('commerce_products_code_key')) throw new Error('Kode produk ini sudah digunakan. Gunakan kode lain.');
    if (error.code === '23505' && error.message.includes('commerce_products_slug_key')) throw new Error('Tautan produk ini sudah digunakan. Ubah tautan pendeknya.');
    if (error.message.includes('ACTIVE_PRODUCT_PRICE_REQUIRED')) throw new Error('Produk yang ditampilkan harus memiliki harga di atas Rp0.');
    if (error.message.includes('PRODUCT_TYPE_NOT_SUPPORTED')) throw new Error('Jenis produk ini belum didukung untuk pemesanan Shop.');
    if (error.message.includes('AUDIENCE_REQUIRED')) throw new Error('Pilih minimal satu kelompok pengguna.');
    if (error.message.includes('IMAGE_URL_INVALID')) throw new Error('Tautan gambar harus diawali http:// atau https://.');
    throw error;
  }

  return data;
}

export async function deleteProduct(id: string) {
  assertId(id);
  const { data, error } = await supabase.rpc('admin_delete_product', { p_product_id: id });
  if (error) throw error;
  return data;
}

export async function banUser(id: string) {
  assertId(id);
  const { data, error } = await supabase.rpc('admin_set_user_status', {
    p_user_id: id,
    p_status: 'BANNED',
    p_reason: 'Admin panel',
  });
  if (error) throw error;
  return data;
}

export async function setUserRole(userId: string, role: 'student' | 'teacher' | 'organizer_member' | 'admin') {
  assertId(userId);
  const { data, error } = await supabase.rpc('admin_set_user_role', {
    p_user_id: userId,
    p_role: role,
    p_active: true,
    p_reason: 'Admin panel',
  });
  if (error) throw error;
  return data;
}

export async function transitionCompetition(id: string, status: string) {
  assertId(id);
  const { data, error } = await supabase.rpc('transition_competition', {
    p_competition_id: id,
    p_to_status: status,
    p_reason: 'Admin panel',
  });
  if (error) throw error;
  return data;
}
