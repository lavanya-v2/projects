import { useAuth } from './context/AuthContext';
import { AppRoutes } from './routes/AppRoutes';
import { AppLayout } from './layout/AppLayout';
import { AccountProvider } from './context/AccountProvider';

/**
 * Root component. Shows the routed content directly when unauthenticated
 * (the Login page is self-contained) and wraps it in the authenticated shell
 * otherwise. AccountProvider is mounted only inside the authenticated branch
 * so account-scoped queries never fire on the login page.
 */
function App() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? (
    <AccountProvider>
      <AppLayout />
    </AccountProvider>
  ) : (
    <AppRoutes />
  );
}

export default App;
