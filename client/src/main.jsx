import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import './styles.css';
import { AuthProvider } from './context/AuthContext.jsx';
import { PrefsProvider } from './context/PrefsContext.jsx';
import { ToastProvider, Empty } from './components/ui.jsx';
import { PublicLayout, CitizenLayout, StaffLayout } from './components/Layouts.jsx';
import Welcome from './pages/public/Welcome.jsx';
import Register from './pages/public/Register.jsx';
import { Login, ForgotPassword, ResetPassword, StaffLogin } from './pages/public/AuthPages.jsx';
import Dashboard from './pages/citizen/Dashboard.jsx';
import Profile from './pages/citizen/Profile.jsx';
import Privacy from './pages/citizen/Privacy.jsx';
import Notifications from './pages/citizen/Notifications.jsx';
import {
  ServicesHome, DepartmentPage, ServiceDetail, PassportHub, PassportFees, PassportOffices, StatusLookup,
} from './pages/citizen/Services.jsx';
import ApplicationWizard from './pages/citizen/ApplicationWizard.jsx';
import { MyApplications, ApplicationDetail } from './pages/citizen/Applications.jsx';
import {
  StaffDashboard, StaffApplications, StaffReview, AccessRequests, AccessDetail, IdentityQueue, IdentityDetail, AuditLog, StaffPassword,
} from './pages/staff/StaffPages.jsx';
import { AdminOverview, AdminStaff, AdminServices, AdminOffices, AdminSharing, AdminSettings } from './pages/admin/AdminPages.jsx';

function NotFound() {
  return <Empty title="This page does not exist" action={<Link to="/" className="btn btn-primary">Go to the start page</Link>}>Check the address, or use the menu to find what you need.</Empty>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PrefsProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<PublicLayout />}>
                <Route path="/" element={<Welcome />} />
                <Route path="/register" element={<Register />} />
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/staff/login" element={<StaffLogin />} />
              </Route>
              <Route element={<CitizenLayout />}>
                <Route path="/home" element={<Dashboard />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/services" element={<ServicesHome />} />
                <Route path="/services/:code" element={<DepartmentPage />} />
                <Route path="/service/:code" element={<ServiceDetail />} />
                <Route path="/passport" element={<PassportHub />} />
                <Route path="/passport/new" element={<ApplicationWizard serviceCode="PASSPORT_NEW" key="new" />} />
                <Route path="/passport/replace" element={<ApplicationWizard serviceCode="PASSPORT_REPLACE" key="replace" />} />
                <Route path="/passport/offices" element={<PassportOffices />} />
                <Route path="/passport/fees" element={<PassportFees />} />
                <Route path="/passport/status" element={<StatusLookup />} />
                <Route path="/apply/:code" element={<ApplicationWizard />} />
                <Route path="/applications" element={<MyApplications />} />
                <Route path="/applications/:id" element={<ApplicationDetail />} />
              </Route>
              <Route element={<StaffLayout />}>
                <Route path="/staff" element={<StaffDashboard />} />
                <Route path="/staff/applications" element={<StaffApplications />} />
                <Route path="/staff/applications/:id" element={<StaffReview />} />
                <Route path="/staff/access" element={<AccessRequests />} />
                <Route path="/staff/access/:id" element={<AccessDetail />} />
                <Route path="/staff/identity" element={<IdentityQueue />} />
                <Route path="/staff/identity/:id" element={<IdentityDetail />} />
                <Route path="/staff/audit" element={<AuditLog />} />
                <Route path="/staff/password" element={<StaffPassword />} />
                <Route path="/staff/admin" element={<AdminOverview />} />
                <Route path="/staff/admin/staff" element={<AdminStaff />} />
                <Route path="/staff/admin/services" element={<AdminServices />} />
                <Route path="/staff/admin/offices" element={<AdminOffices />} />
                <Route path="/staff/admin/sharing" element={<AdminSharing />} />
                <Route path="/staff/admin/settings" element={<AdminSettings />} />
              </Route>
              <Route path="/dashboard" element={<Navigate to="/home" replace />} />
              <Route element={<PublicLayout />}><Route path="*" element={<NotFound />} /></Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </PrefsProvider>
  </React.StrictMode>
);
