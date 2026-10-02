import './globals.css';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import '@fontsource/noto-sans-thai/700.css';
import { CartProvider } from '../lib/cart';
import { CustomerAccessGate } from '../components/customer-access-gate';

export const metadata = {
  title: 'Select Topic 2 | ร้านอาหารใกล้คุณ',
  description: 'ค้นหาร้าน เมนู และค่าส่งถึงหอพักของคุณ',
};

export default function RootLayout({ children }) {
  return <html lang="th" data-scroll-behavior="smooth"><body><CustomerAccessGate><CartProvider>{children}</CartProvider></CustomerAccessGate></body></html>;
}
