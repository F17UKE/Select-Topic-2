export function isStaffBrowserPath(pathname) {
  return pathname === '/merchant' || pathname.startsWith('/merchant/')
    || pathname === '/rider' || pathname.startsWith('/rider/');
}

export function resolveCustomerBrowserAccess({ pathname, authMode, isInClient }) {
  if (isStaffBrowserPath(pathname)) return 'allowed';
  if (!authMode) return 'loading';
  if (authMode !== 'line') return 'allowed';
  return isInClient ? 'allowed' : 'line_client_required';
}
