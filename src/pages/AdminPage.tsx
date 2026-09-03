import { useSearchParams } from 'react-router-dom';
import { AdminPageLegacy } from '@/pages/AdminPageLegacy';
import { AdminUsersPage } from '@/pages/AdminUsersPage';

export function AdminPage() {
  const [params] = useSearchParams();
  return params.get('tab') === 'users' ? <AdminUsersPage /> : <AdminPageLegacy />;
}
