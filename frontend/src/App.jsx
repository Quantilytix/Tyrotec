import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './components/layout/DashboardLayout';

import Login from './pages/Login';
import Register from './pages/Register';
import AcceptStaffInvite from './pages/AcceptStaffInvite';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AuthCallback from './pages/AuthCallback';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import ProductsPage from './pages/ProductsPage';
import CartPage from './pages/CartPage';
import QuotesPage from './pages/QuotesPage';
import QuoteDetailPage from './pages/QuoteDetailPage';
import OrdersPage from './pages/OrdersPage';
import OrderDetailPage from './pages/OrderDetailPage';
import NotificationsPage from './pages/NotificationsPage';
import Profile from './pages/Profile';
import AdminProductsPage from './pages/admin/AdminProductsPage';
import AdminQuotesPage from './pages/admin/AdminQuotesPage';
import AdminNewQuotePage from './pages/admin/AdminNewQuotePage';
import AdminQuoteDetailPage from './pages/admin/AdminQuoteDetailPage';
import AdminOrdersPage from './pages/admin/AdminOrdersPage';
import AdminOrderDetailPage from './pages/admin/AdminOrderDetailPage';
import AdminPaymentsPage from './pages/admin/AdminPaymentsPage';
import AdminCustomersPage from './pages/admin/AdminCustomersPage';
import AdminCustomerDetailPage from './pages/admin/AdminCustomerDetailPage';
import AdminAnalyticsPage from './pages/admin/AdminAnalyticsPage';
import AdminStaffPage from './pages/admin/AdminStaffPage';
import AdminActivityLogPage from './pages/admin/AdminActivityLogPage';
import AdminReviewsPage from './pages/admin/AdminReviewsPage';

import { STAFF_ROLES, isStaff } from './utils/roles';

// Staff land on the product catalog they manage; customers land on the one
// they shop from.
function HomeRedirect() {
  const { user } = useAuth();
  const target = isStaff(user?.role) ? '/admin/products' : '/products';
  return <Navigate to={target} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            {/* Staff accounts are invite-only: this is where an invitation link lands. */}
            <Route path="/staff/accept-invite" element={<AcceptStaffInvite />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />

            <Route
              element={
                <ProtectedRoute roles={['customer']}>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/products" element={<ProductsPage />} />
            </Route>

            <Route
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/cart" element={<CartPage />} />
              <Route path="/quotes" element={<QuotesPage />} />
              <Route path="/quotes/:quoteId" element={<QuoteDetailPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/profile" element={<Profile />} />
            </Route>

            <Route
              element={
                <ProtectedRoute roles={STAFF_ROLES}>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/admin/products" element={<AdminProductsPage />} />
              <Route path="/admin/quotes" element={<AdminQuotesPage />} />
              <Route path="/admin/quotes/new" element={<AdminNewQuotePage />} />
              <Route path="/admin/quotes/:quoteId" element={<AdminQuoteDetailPage />} />
              <Route path="/admin/orders" element={<AdminOrdersPage />} />
              <Route path="/admin/orders/:id" element={<AdminOrderDetailPage />} />
              <Route path="/admin/payments" element={<AdminPaymentsPage />} />
              <Route path="/admin/customers" element={<AdminCustomersPage />} />
              <Route path="/admin/customers/:id" element={<AdminCustomerDetailPage />} />
              <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
              <Route path="/admin/reviews" element={<AdminReviewsPage />} />
            </Route>

            <Route
              element={
                <ProtectedRoute roles={['admin']}>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/admin/staff" element={<AdminStaffPage />} />
              <Route path="/admin/activity-log" element={<AdminActivityLogPage />} />
            </Route>

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <HomeRedirect />
                </ProtectedRoute>
              }
            />
            <Route
              path="*"
              element={
                <ProtectedRoute>
                  <HomeRedirect />
                </ProtectedRoute>
              }
            />
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
