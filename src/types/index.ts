export type Role = 'pelajar' | 'guru' | 'penyelenggara' | 'admin';

export type EducationLevel = 'sd' | 'smp' | 'sma';

export interface Emblem { id: string; name: string; competitionTitle: string; position: string; color: string; icon: string; }

export interface User {
  id: string; username: string; email: string; displayName: string; role: Role; avatarUrl?: string; bio?: string; school?: string;
  educationLevel?: EducationLevel; birthDate?: string; points: number; rank: number; joinedAt: string; favoriteCategories: string[];
  profilePhoto?: string; coverPhoto?: string; badges: string[]; emblems: Emblem[]; showcaseEmblems?: string[]; followers: number;
  following: number; verified?: boolean; pembina?: string;
}

export type CompetitionCategory = 'mtk' | 'ipa' | 'ips' | 'bindo' | 'bing' | 'seni' | 'olahraga' | 'tech' | 'lingkungan';
export type CompetitionStatus = 'upcoming' | 'open' | 'in-progress' | 'completed';
export interface PrizeEntry { position: string; detail: string; emblems: string[]; points: number; }
export interface Competition {
  id: string; slug: string; title: string; category: CompetitionCategory; posterUrl?: string; shortDesc: string; description: string;
  juknis: string; juknisPdfUrl?: string; prizes: PrizeEntry[]; points: number; startDate: string; endDate: string;
  registrationDeadline: string; status: CompetitionStatus; participants: number; level: string; twibbonUrl: string; hasQuestions: boolean; featured?: boolean;
}

export type QuestionType = 'multiple-choice' | 'short-answer' | 'essay' | 'file-upload';
export interface QuestionOption { id: string; label: string; }
export interface Question { id: string; type: QuestionType; prompt: string; required: boolean; points: number; options?: QuestionOption[]; correctOptionId?: string; correctText?: string; explanation?: string; }
export interface CompetitionRegistration { id: string; competitionId: string; userId: string; status: 'pending' | 'approved' | 'rejected'; twibbonImage?: string; socialPlatform: 'instagram' | 'tiktok'; socialUsername: string; postUrl: string; registeredAt: string; reviewedAt?: string; }
export interface Submission { id: string; competitionId: string; userId: string; status: 'in-review' | 'scored' | 'rejected'; score?: number; rank?: number; submittedAt: string; answers: Record<string, string | string[]>; }
export type DailyTaskType = 'quiz' | 'assignment' | 'streak';
export interface DailyTask { id: string; title: string; type: DailyTaskType; description: string; points: number; date: string; expiresAt: string; completed: boolean; retryUsed: number; maxRetry: number; quiz?: { questions: { id: string; prompt: string; options: { id: string; label: string }[]; correctOptionId: string; explanation?: string; }[]; }; }

export interface LeaderboardEntry {
  rank: number; userId: string; username: string; displayName: string; avatarUrl?: string; profilePhoto?: string; points: number;
  school?: string; pembina?: string; educationLevel?: EducationLevel; emblems: Emblem[]; change: number; pointChange?: number;
  rankStatus?: 'up' | 'same' | 'down'; isCurrentUser?: boolean; classGrade?: number;
}

export type CertificateType = 'winner' | 'participant' | 'finalist' | 'achievement';
export interface Certificate { id: string; code: string; userId: string; competitionId: string; competitionTitle: string; type: CertificateType; rank?: number; score?: number; issuedAt: string; verified: boolean; }
export type AwardType = 'certificate' | 'medal' | 'badge';
export interface Award { id: string; type: AwardType; title: string; subtitle: string; date: string; competitionId?: string; certificateId?: string; imageUrl?: string; color: string; emblems?: string[]; points?: number; }
export type NotificationType = 'competition-start' | 'result-out' | 'registration-approved' | 'registration-rejected' | 'order-update' | 'daily-reminder' | 'rank-up' | 'twibbon-verified';
export interface AppNotification { id: string; type: NotificationType; title: string; body: string; createdAt: string; read: boolean; link?: string; icon?: string; }
export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled';
export interface OrderItem { id: string; category: 'sertifikat' | 'medali' | 'emblem'; itemName: string; quantity: number; price: number; }
export interface Order { id: string; code: string; payCode: string; userId: string; items: OrderItem[]; total: number; status: OrderStatus; address: string; trackingNumber?: string; createdAt: string; updatedAt: string; }
export interface Comment { id: string; postId: string; userId: string; authorName: string; authorUsername: string; authorId: string; authorEmblems?: string[]; body: string; createdAt: string; likes: number; liked?: boolean; replies: Comment[]; }
export interface FeedPost { id: string; userId: string; competitionId?: string; competitionSlug?: string; type: 'achievement' | 'competition' | 'daily-task' | 'post'; title: string; body: string; createdAt: string; likes: number; reposts: number; liked?: boolean; image?: string; meta?: string; comments: Comment[]; }
