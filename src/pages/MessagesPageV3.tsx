import { useApp } from '@/store/AppContext';
import { MessagesPageV6 } from './MessagesPageV6';
import { AdminChatConsolePage } from './AdminChatConsolePage';
export function MessagesPageV3(){const { user } = useApp(); return user?.role === 'admin' ? <AdminChatConsolePage/> : <MessagesPageV6/>;}
