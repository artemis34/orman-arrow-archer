/** Shared rules: client movement prediction and the server use these same constants. */
export const RULES = Object.freeze({size:84,tick:30,speed:7.4,radius:.62,drawTime:.85,dashCooldown:3,dashDuration:.16,dashSpeed:25,maxPlayers:24,maxArrows:360,maxOrbs:140});
export const UPGRADES = Object.freeze({
  multishot:{name:'Çatal atış',icon:'⋔',description:'Yayından üç ok çıkar. Yan oklar %55 hasar verir.',max:1},
  pierce:{name:'Delici ok',icon:'↠',description:'Okların bir rakibin içinden geçebilir.',max:2},
  bounce:{name:'Sekme',icon:'⌁',description:'Okların arena sınırından bir kez seker.',max:2},
  poison:{name:'Zehir',icon:'✧',description:'İsabetler 3 saniye boyunca ek hasar verir.',max:3},
  speed:{name:'Rüzgâr adımı',icon:'»',description:'Hareket hızını %12 artırır.',max:3},
  draw:{name:'Çevik yay',icon:'ϟ',description:'Yay germe süresini %18 kısaltır.',max:3},
  vitality:{name:'Orman kalbi',icon:'♡',description:'Azami canını 25 artırır ve 40 can yeniler.',max:4}
});
export const SKINS=[{id:'fern',name:'Orman',body:0x71cfa0,cape:0x244b42},{id:'ember',name:'Kor',body:0xf3aa72,cape:0x8a3d38},{id:'iris',name:'İris',body:0xb8a1ef,cape:0x534479},{id:'tide',name:'Gelgit',body:0x7ac9e2,cape:0x28586b}];
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function cleanInput(data={}) {
 const num=(v)=>Number.isFinite(v)?v:0;
 let x=clamp(num(data.x),-1,1),z=clamp(num(data.z),-1,1),l=Math.hypot(x,z);
 if(l>1){x/=l;z/=l;}
 return {x,z,angle:num(data.angle)%(Math.PI*2),charge:data.charge===true,dash:data.dash===true,seq:clamp(Math.floor(num(data.seq)),0,2147483647)};
}
export function moveBody(p,input,dt,obstacles) {
 const speed=p.dashTime>0?RULES.dashSpeed:RULES.speed*(1+.12*(p.upgrades?.speed||0));
 const move=p.dashTime>0?{x:p.dashX,z:p.dashZ}:input;
 p.x=clamp(p.x+move.x*speed*dt,-RULES.size/2+RULES.radius,RULES.size/2-RULES.radius);
 p.z=clamp(p.z+move.z*speed*dt,-RULES.size/2+RULES.radius,RULES.size/2-RULES.radius);
 for(const o of obstacles){
  if(o.type==='bush')continue;
  const dx=p.x-o.x,dz=p.z-o.z,d=Math.hypot(dx,dz),r=o.r+RULES.radius;
  if(d<r){p.x=o.x+(d?dx/d:1)*r;p.z=o.z+(d?dz/d:0)*r;}
 }
 p.x=clamp(p.x,-RULES.size/2+RULES.radius,RULES.size/2-RULES.radius);
 p.z=clamp(p.z,-RULES.size/2+RULES.radius,RULES.size/2-RULES.radius);
}
