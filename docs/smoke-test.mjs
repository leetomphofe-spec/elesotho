// Usage: node docs/smoke-test.mjs [http://localhost:4000]  (run against a fresh database with SEED_DEMO=true)
const BASE = (process.argv[2] || 'http://localhost:4000') + '/api';
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method, headers: { 'content-type': 'application/json', 'x-requested-with': 'gov-portal', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) console.log(`  ${method} ${path} -> ${r.status}`, JSON.stringify(j).slice(0, 300));
    return { status: r.status, body: j };
  };
}
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);

// Journey 1: register, new passport
const cit = client();
let r = await cit('POST', '/auth/register', { hasNationalId: true, nationalId: 'DEMO100007', firstName: 'Mpho', surname: 'Khoali', dateOfBirth: '1999-07-21', sex: 'F', phone: '62000007', email: '', district: 'Quthing', password: 'Secret123', acceptTerms: true });
ok(r.status === 201 && r.body.citizen.verificationStatus === 'verified', 'J1 register auto-verified');
r = await cit('POST', '/applications', { serviceCode: 'PASSPORT_NEW', category: 'adult' });
const appId = r.body.application.id; ok(r.status === 201, 'J1 draft created ' + r.body.application.reference);
r = await cit('GET', `/applications/${appId}`);
const reqs = r.body.requirements; ok(reqs.length === 2, 'J1 adult new passport has 2 requirements: ' + reqs.map(x => x.label).join(' / '));
const fee = r.body.fees.find(f => f.code === 'REG64');
r = await cit('PATCH', `/applications/${appId}`, { requirementsReviewed: true, checklist: { [reqs[0].id]: true }, feeId: fee.id });
ok(r.body.progress.done === 1 && r.body.status === 'preparing_documents', 'J1 checklist 1 of 2, status preparing');
r = await cit('POST', `/applications/${appId}/confirm`, {});
ok(r.status === 400, 'J1 confirm blocked while incomplete');
await cit('PATCH', `/applications/${appId}`, { checklist: { [reqs[0].id]: true, [reqs[1].id]: true } });
r = await cit('GET', '/catalogue/offices?department=PASSPORT&q=quthing');
const office = r.body.offices[0]; ok(office && office.district === 'Quthing', 'J1 office search by district');
r = await cit('GET', `/catalogue/offices/${office.id}/slots`);
const slot = r.body.nextAvailable; ok(!!slot, 'J1 next slot ' + slot.day + ' ' + slot.time);
await cit('PATCH', `/applications/${appId}`, { officeId: office.id, proposedSlotId: slot.id });
r = await cit('POST', `/applications/${appId}/confirm`, {});
ok(r.body.status === 'ready_for_visit', 'J1 confirmed -> ready for visit');

// Minor replacement blocked
r = await cit('POST', '/applications', { serviceCode: 'PASSPORT_REPLACE', category: 'minor', minor: { firstName: 'Kid', surname: 'Khoali', dateOfBirth: '2018-01-01', birthCertificateNo: 'BC123', relationship: 'parent' } });
ok(r.status === 400, 'Minor replacement blocked (requirements unconfirmed)');

// Journey 5: passport officer check-in
const ps = client();
await ps('POST', '/auth/staff/login', { identifier: 'PS-001', password: 'Staff@2026' });
r = await ps('GET', `/staff/applications/${appId}`);
ok(r.status === 200 && r.body.citizen.phone.visible === false && r.body.citizen.national_id.visible === true, 'J5 passport sees ID, not phone');
const results = Object.fromEntries(r.body.requirements.map(q => [q.id, 'verified']));
r = await ps('POST', `/staff/applications/${appId}/check-in`, { results });
ok(r.body.status === 'under_review', 'J5 check-in -> automatic checks -> under review');
// Traffic officer denied
const tr = client();
await tr('POST', '/auth/staff/login', { identifier: 'traffic.officer@gov.ls.demo', password: 'Staff@2026' });
r = await tr('GET', `/staff/applications/${appId}`);
ok(r.status === 403, 'J5 traffic officer denied passport application');

// Journey 6: passport requests phone (consent + auto approve)
r = await ps('POST', '/access-requests', { applicationId: appId, fields: ['phone'], purpose: 'Contact the applicant about passport collection' });
ok(r.body.request.status === 'pending_consent', 'J6 request needs citizen consent');
const arId = r.body.request.id;
r = await cit('POST', `/citizen/consents/${arId}`, { decision: 'give' });
ok(r.body.request.status === 'approved', 'J6 consent -> auto approved by policy');
r = await ps('GET', `/staff/applications/${appId}`);
ok(r.body.citizen.phone.visible === true, 'J6 phone now visible');
// Police no-consent, needs supervisor
const pl = client();
await pl('POST', '/auth/staff/login', { identifier: 'PL-001', password: 'Staff@2026' });
r = await pl('POST', '/access-requests', { applicationId: appId, fields: ['address'], purpose: 'Contact a person named in a report' });
ok(r.status === 403, 'J6 police cannot request on another department application');
r = await ps('POST', '/access-requests', { applicationId: appId, fields: ['email'], purpose: 'Send collection notice by email' });
ok(r.body.request.status === 'denied', 'J6 no policy -> auto denied');
// Supervisor flow: pension address request needs approval
const pen = client();
await pen('POST', '/auth/staff/login', { identifier: 'PN-001', password: 'Staff@2026' });
const elder = client();
await elder('POST', '/auth/login', { identifier: '58000002', password: 'Citizen@2026' });
r = await elder('POST', '/applications', { serviceCode: 'PENSION_LIFE_CERT', category: 'adult' });
const pApp = r.body.application.id;
r = await pen('POST', '/access-requests', { applicationId: pApp, fields: ['address'], purpose: 'Arrange a home visit for an elderly beneficiary' });
const par = r.body.request.id;
await elder('POST', `/citizen/consents/${par}`, { decision: 'give' });
const ha = client();
await ha('POST', '/auth/staff/login', { identifier: 'HA-002', password: 'Staff@2026' });
r = await ha('GET', '/access-requests?scope=approvals');
ok(r.body.requests.some(x => x.id === par && x.status === 'pending_approval'), 'J6 request in HA supervisor approvals');
r = await ha('POST', `/access-requests/${par}/decision`, { decision: 'approved', note: 'Home visit justified for elderly citizen' });
ok(r.body.request.status === 'approved', 'J6 supervisor approved');
r = await ha('GET', `/access-requests/${par}`);
ok(r.body.trail.length >= 3, 'J6 audit trail entries: ' + r.body.trail.map(t => t.action).join(', '));

// Journey 4: elderly pension
r = await elder('POST', '/applications', { serviceCode: 'OLD_AGE_PENSION', category: 'adult' });
ok(r.status === 201, 'J4 elderly can start old age pension');
r = await cit('POST', '/applications', { serviceCode: 'OLD_AGE_PENSION', category: 'adult' });
ok(r.status === 400, 'J4 young citizen blocked from pension: ' + r.body.error);

// Officer completes; audit
r = await ps('POST', `/staff/applications/${appId}/status`, { to: 'completed' });
ok(r.body.status === 'completed', 'Officer completed application');
const psup = client();
await psup('POST', '/auth/staff/login', { identifier: 'PS-002', password: 'Staff@2026' });
r = await psup('GET', '/audit');
ok(r.body.entries.length > 0 && r.body.scope === 'department', 'Supervisor audit log: ' + r.body.total + ' entries');
r = await cit('GET', '/citizen/notifications');
ok(r.body.notifications.length >= 4, 'Citizen notifications: ' + r.body.notifications.map(n => n.title).join(' | '));
r = await cit('POST', '/auth/forgot-password', { identifier: '62000007' });
ok(!!r.body.demoResetLink, 'Forgot password link (demo)');
const adm = client();
await adm('POST', '/auth/staff/login', { identifier: 'admin@gov.ls.demo', password: 'Admin@2026!' });
r = await adm('POST', '/admin/automation/run');
ok(r.status === 200, 'Admin run automation ' + JSON.stringify(r.body.result));
r = await adm('GET', `/staff/applications/${appId}`);
ok(r.status === 403, 'Admin cannot open citizen applications');
