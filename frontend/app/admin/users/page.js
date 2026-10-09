'use client';
import { AdminContentManager } from '../../../components/admin-content-manager';
const fields = [
  { key:'username', label:'Username', required:true, minLength:3, maxLength:80, createOnly:true },
  { key:'fullName', label:'ชื่อ', required:true, maxLength:160 },
  { key:'email', label:'Email', type:'email', nullable:true },
  { key:'role', label:'สิทธิ์', options:['SUPER_ADMIN','ADMIN','SUPPORT','FINANCE'] },
  { key:'isActive', label:'เปิดใช้', type:'checkbox' },
  { key:'password', label:'Password ใหม่ (เว้นว่างเมื่อไม่เปลี่ยน)', type:'password', minLength:12, maxLength:72, omitEmpty:true },
];
const blank = {username:'',fullName:'',email:'',role:'ADMIN',isActive:true,password:''};
const fromRow = (item) => ({username:item.username,fullName:item.full_name,email:item.email ?? '',role:item.role,isActive:item.is_active,password:''});
export default function Page(){return <AdminContentManager title="ผู้ดูแลระบบ" endpoint="/api/admin/users" fields={fields} blank={blank} fromRow={fromRow} columns={[{key:'username',label:'Username'},{key:'full_name',label:'ชื่อ'},{key:'email',label:'อีเมล'},{key:'role',label:'สิทธิ์'},{key:'is_active',label:'สถานะ',status:true},{key:'last_login_at',label:'เข้าสู่ระบบล่าสุด',type:'date'}]} />;}
