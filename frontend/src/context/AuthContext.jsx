import { createContext, useContext, useEffect, useState } from 'react';
import { loginRequest, registerRequest, getMeRequest, updateMeRequest, oauthCompleteRequest } from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On first load, if we have a stored token, verify it's still valid by
  // fetching the profile. This is what keeps a customer logged in across
  // page refreshes.
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setLoading(false);
      return;
    }
    getMeRequest()
      .then(({ data }) => setUser(data.user))
      .catch(() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await loginRequest(email, password);
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    setUser(data.user);
    return data.user;
  };

  const register = async (email, password, companyName, role, fullName, phone, vatNumber, isVatRegistered) => {
    const { data } = await registerRequest(
      email,
      password,
      companyName,
      role,
      fullName,
      phone,
      vatNumber,
      isVatRegistered
    );
    // A staff (sales_rep) signup lands as 'pending' -- there's no session to
    // log in with yet, it's awaiting admin approval. Only customer signups
    // (the default) get an immediate session.
    if (data.pending) {
      return { pending: true, message: data.message };
    }
    return login(email, password);
  };

  // Called from /auth/callback once Google Sign-In has already produced a
  // real Supabase session client-side -- session comes from Supabase
  // directly (access_token/refresh_token/expires_at), the profile comes
  // from our own backend (oauth-complete), same split responsibility as
  // everywhere else: Supabase owns auth, our backend owns the profile.
  const completeOAuthLogin = async (session) => {
    const { data } = await oauthCompleteRequest(session.access_token);
    localStorage.setItem('access_token', session.access_token);
    localStorage.setItem('refresh_token', session.refresh_token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  };

  const updateProfile = async (fields) => {
    const { data } = await updateMeRequest(fields);
    setUser(data.user);
    return data.user;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile, completeOAuthLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
