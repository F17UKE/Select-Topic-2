'use client';
import { useCallback, useEffect, useState } from 'react';
import { AdminError, AdminShell, StatusBadge } from '../../../components/admin-shell';
import { AdminEditor, AdminPagination } from '../../../components/admin-editor';
import { AdminDialog } from '../../../components/admin-ui';
import { api } from '../../../lib/api';

const soiFields = [{key:'name',label:'ชื่อซอย',required:true,maxLength:160},{key:'isActive',label:'เปิดใช้งาน',type:'checkbox'}];
const dormFields = [{key:'soiId',label:'Soi ID',type:'number',min:1,required:true,createOnly:true},{key:'name',label:'ชื่อหอพัก',required:true,maxLength:160},{key:'locationText',label:'ที่ตั้ง',required:true,maxLength:500},{key:'isActive',label:'เปิดใช้งาน',type:'checkbox'}];
export default function Page() {
  const [data,setData]=useState({items:[],pagination:{}}); const [query,setQuery]=useState(''); const [page,setPage]=useState(1); const [error,setError]=useState(''); const [editor,setEditor]=useState(null);
  const load=useCallback(()=>api(`/api/admin/delivery-areas?${new URLSearchParams({q:query,page:String(page)})}`).then(setData).catch((e)=>setError(e.message)),[query,page]);
  useEffect(()=>{void Promise.resolve().then(load);},[load]);
  function editSoi(soi) {setEditor({kind:'sois',id:soi.id,values:{name:soi.name,isActive:soi.is_active}});}
  function editDorm(dorm) {setEditor({kind:'dormitories',id:dorm.id,values:{soiId:dorm.soi_id,name:dorm.name,locationText:dorm.location_text,isActive:dorm.is_active}});}
  return <AdminShell title="พื้นที่จัดส่ง" description="ซอย หอพัก และจำนวนร้านที่จัดส่งได้" actions={<button className="admin-secondary" onClick={()=>setEditor({kind:'sois',values:{name:'',isActive:true}})}>เพิ่มซอย</button>}>
    <AdminError>{error}</AdminError><div className="admin-filterbar"><label>ค้นหาซอย<input value={query} onChange={(e)=>{setQuery(e.target.value);setPage(1);}} /></label></div>
    {editor && <AdminDialog title={editor.kind==='sois'?'จัดการซอย':'จัดการหอพัก'} onClose={()=>setEditor(null)}><AdminEditor key={`${editor.kind}-${editor.id || 'new'}`} title={editor.kind==='sois'?'จัดการซอย':'จัดการหอพัก'} endpoint={`/api/admin/delivery-areas/${editor.kind}${editor.id?`/${editor.id}`:''}`} fields={(editor.kind==='sois'?soiFields:dormFields).filter(field=>!editor.id||!field.createOnly)} initial={editor.values} editing={Boolean(editor.id)} onCancel={()=>setEditor(null)} onSaved={async()=>{setEditor(null);await load();}} /></AdminDialog>}
    <section className="admin-card-grid">{data.items.map((soi)=><article className="admin-panel" key={soi.id}><div className="admin-panel-heading"><div><h2>{soi.name}</h2><p>{soi.merchant_coverage} ร้าน · {soi.dormitory_count} หอพัก</p></div><StatusBadge value={soi.is_active?'ACTIVE':'INACTIVE'}/></div><ul className="admin-simple-list">{soi.dormitories.map((dorm)=><li key={dorm.id}><div>{dorm.name}<small>{dorm.location_text}</small></div><StatusBadge value={dorm.is_active?'ACTIVE':'INACTIVE'}/><button className="admin-secondary" onClick={()=>editDorm(dorm)}>แก้ไข</button></li>)}</ul><div className="admin-actions"><button className="admin-secondary" onClick={()=>editSoi(soi)}>แก้ไขซอย</button> <button className="admin-secondary" onClick={()=>setEditor({kind:'dormitories',values:{soiId:soi.id,name:'',locationText:'',isActive:true}})}>เพิ่มหอพัก</button></div></article>)}</section>
    <AdminPagination pagination={data.pagination} onPage={setPage} />
  </AdminShell>;
}
