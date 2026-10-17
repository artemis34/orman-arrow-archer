/** Uniform grid broad phase. Query visits only intersecting cells. */
export class SpatialGrid {
 constructor(cell=6){this.cell=cell;this.cells=new Map();}
 clear(){this.cells.clear();}
 key(x,z){return `${Math.floor(x/this.cell)},${Math.floor(z/this.cell)}`;}
 insert(object,r=0){for(let x=Math.floor((object.x-r)/this.cell);x<=Math.floor((object.x+r)/this.cell);x++)for(let z=Math.floor((object.z-r)/this.cell);z<=Math.floor((object.z+r)/this.cell);z++){const k=`${x},${z}`;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(object);}}
 query(x,z,r){const result=new Set();for(let a=Math.floor((x-r)/this.cell);a<=Math.floor((x+r)/this.cell);a++)for(let b=Math.floor((z-r)/this.cell);b<=Math.floor((z+r)/this.cell);b++)for(const o of this.cells.get(`${a},${b}`)||[])result.add(o);return result;}
}
/** Swept segment-circle intersection prevents tunnelling by fast arrows. */
export function segmentHit(ax,az,bx,bz,cx,cz,r){const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((cx-ax)*dx+(cz-az)*dz)/l)):0;return Math.hypot(ax+t*dx-cx,az+t*dz-cz)<=r;}
export class Pool {constructor(create,max){this.free=Array.from({length:max},create);this.active=[];}acquire(){const o=this.free.pop();if(o)this.active.push(o);return o;}release(index){const o=this.active[index];this.active[index]=this.active[this.active.length-1];this.active.pop();this.free.push(o);}}
