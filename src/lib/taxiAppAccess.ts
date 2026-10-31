export type TaxiAppRole='superadmin'|'admin_empresa'|'operador'|'owner'|'owner_driver'|'driver';
const basic=['/drivers','/map','/devices'];
const owner=[...basic,'/dashboard','/reports','/replay','/notifications'];
export function taxiAppAccess(role:TaxiAppRole|null){
 const ownsTaxi=role==='owner'||role==='owner_driver',personal=ownsTaxi||role==='driver';
 return{personal,ownsTaxi,advanced:role!==null&&role!=='driver',home:personal?'/drivers':'/dashboard',roleLabel:role==='owner'?'Propietario':role==='owner_driver'?'Dueño y conductor':role==='driver'?'Conductor':role==='superadmin'?'Super Administrador':role==='admin_empresa'?'Admin de Empresa':role==='operador'?'Operador':'Sin acceso',peopleLabel:ownsTaxi?'Mi taxi y choferes':role==='driver'?'Mi taxi y turno':'Conductores',canOpen:(path:string)=>role!==null&&(!personal||(ownsTaxi?owner:basic).includes(path))};
}
