import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const AuthContext = createContext(null);

/**
 * Holds either a signed-in citizen or a signed-in staff member.
 * The session itself lives in an httpOnly cookie; this only mirrors who is signed in.
 */
export function AuthProvider({ children }) {
  const [citizen, setCitizen] = useState(null);
  const [staff, setStaff] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [endedReason, setEndedReason] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/auth/me', { silent: true });
      setCitizen(r.citizen); setStaff(null); setExpiresAt(r.sessionExpiresAt);
      return r;
    } catch {
      try {
        const r = await api.get('/auth/staff/me', { silent: true });
        setStaff(r.staff); setCitizen(null); setExpiresAt(r.sessionExpiresAt);
        return r;
      } catch {
        setCitizen(null); setStaff(null);
        return null;
      }
    }
  }, []);

  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);

  useEffect(() => {
    const onEnd = () => {
      setEndedReason('Your session ended because you were inactive. Log in again to continue.');
      setCitizen(null); setStaff(null);
    };
    window.addEventListener('session-ended', onEnd);
    return () => window.removeEventListener('session-ended', onEnd);
  }, []);

  const loginCitizen = async (identifier, password) => {
    const r = await api.post('/auth/login', { identifier, password });
    setCitizen(r.citizen); setStaff(null); setExpiresAt(r.sessionExpiresAt); setEndedReason(null);
    return r.citizen;
  };
  const register = async (data) => {
    const r = await api.post('/auth/register', data);
    setCitizen(r.citizen); setStaff(null); setExpiresAt(r.sessionExpiresAt); setEndedReason(null);
    return r.citizen;
  };
  const loginStaff = async (identifier, password) => {
    const r = await api.post('/auth/staff/login', { identifier, password });
    setStaff(r.staff); setCitizen(null); setExpiresAt(r.sessionExpiresAt); setEndedReason(null);
    return r.staff;
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setCitizen(null); setStaff(null); setEndedReason(null);
  };

  const value = useMemo(() => ({
    citizen, staff, loading, expiresAt, endedReason, setEndedReason,
    setCitizen, setStaff, setExpiresAt, refresh, loginCitizen, loginStaff, register, logout,
  }), [citizen, staff, loading, expiresAt, endedReason, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
