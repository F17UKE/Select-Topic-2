let sdkPromise;
let initPromise;
let initializedLiffId;

function loadLiffSdk() {
  if (window.liff) return Promise.resolve(window.liff);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    script.async = true;
    script.onload = () => resolve(window.liff);
    script.onerror = () => reject(new Error('โหลด LINE LIFF SDK ไม่สำเร็จ'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

async function initializeLiff(liffId) {
  if (!liffId) throw new Error('ยังไม่ได้ตั้งค่า LINE LIFF ID');
  const liff = await loadLiffSdk();
  if (!initPromise || initializedLiffId !== liffId) {
    initializedLiffId = liffId;
    initPromise = liff.init({ liffId }).then(() => liff).catch((error) => {
      initPromise = undefined;
      initializedLiffId = undefined;
      throw error;
    });
  }
  return initPromise;
}

export async function isInLiffClient(liffId) {
  const liff = await initializeLiff(liffId);
  return liff.isInClient();
}

export async function getLiffIdToken(liffId) {
  const liff = await initializeLiff(liffId);
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    return null;
  }
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error('LINE ไม่ได้ส่ง ID token กลับมา');
  return idToken;
}
