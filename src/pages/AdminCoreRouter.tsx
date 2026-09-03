import { useSearchParams } from 'react-router-dom';
import { AdminPage } from '@/pages/AdminPage';
import { AdminUsersPage } from '@/pages/AdminUsersPage';

export function AdminCoreRouter() {
  const [searchParams] = useSearchParams();
  return searchParams.get('tab') === 'users' ? <AdminUsersPage /> : <AdminPage />;
}
