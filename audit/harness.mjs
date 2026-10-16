// Audit harness: runs the ORIGINAL game logic (unmodified source text) in a Node vm
// with a stubbed THREE (real vector math + real centripetal Catmull-Rom) and fake timers.
import vm from 'node:vm';
import fs from 'node:fs';

const SRC = process.argv[2];
const html = fs.readFileSync(SRC, 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
let code = m[1].replace("import * as THREE from 'three';", '').replace(/\n\s*init\(\);\s*$/, '\n');

// ---------- seeded RNG ----------
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

// ---------- THREE stub ----------
const counts = { geometry: 0, material: 0, mesh: 0 };
class V3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setScalar(s){this.x=this.y=this.z=s;return this;}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  clone(){return new V3(this.x,this.y,this.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  subVectors(a,b){this.x=a.x-b.x;this.y=a.y-b.y;this.z=a.z-b.z;return this;}
  addScaledVector(v,s){this.x+=v.x*s;this.y+=v.y*s;this.z+=v.z*s;return this;}
  multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  length(){return Math.sqrt(this.lengthSq());}
  normalize(){const l=this.length()||1;return this.multiplyScalar(1/l);}
  distanceToSquared(v){const dx=this.x-v.x,dy=this.y-v.y,dz=this.z-v.z;return dx*dx+dy*dy+dz*dz;}
  distanceTo(v){return Math.sqrt(this.distanceToSquared(v));}
  lerp(v,a){this.x+=(v.x-this.x)*a;this.y+=(v.y-this.y)*a;this.z+=(v.z-this.z)*a;return this;}
}
class Col { constructor(h){this.hex=h;} setHex(h){this.hex=h;return this;} setHSL(){return this;} set(h){this.hex=h;return this;} }
class Obj {
  constructor(){this.position=new V3();this.rotation={x:0,y:0,z:0};this.scale=new V3(1,1,1);this.children=[];this.userData={};this.name='';this.parent=null;}
  add(o){this.children.push(o);o.parent=this;return this;}
  remove(o){const i=this.children.indexOf(o);if(i>=0)this.children.splice(i,1);o.parent=null;return this;}
  getObjectByName(n){for(const c of this.children){if(c.name===n)return c;}return undefined;}
  clone(){const c=new this.constructor();c.geometry=this.geometry;c.material=this.material;c.position.copy(this.position);c.scale.copy(this.scale);c.userData={...this.userData};c.children=this.children.slice();return c;}
}
class Mesh extends Obj { constructor(g,mat){super();this.geometry=g;this.material=mat;counts.mesh++;} }
class Mat { constructor(p={}){counts.material++;this.color=new Col(p.color);this.emissive=new Col(p.emissive);this.opacity=p.opacity??1;Object.assign(this,{emissiveIntensity:p.emissiveIntensity});} dispose(){} }
class Geo { constructor(){counts.geometry++;} dispose(){} setFromPoints(){return this;} setAttribute(){} }
function cubicPoly(){let c0=0,c1=0,c2=0,c3=0;function init(x0,x1,t0,t1){c0=x0;c1=t0;c2=-3*x0+3*x1-2*t0-t1;c3=2*x0-2*x1+t0+t1;}
  return{initNonuniformCatmullRom(x0,x1,x2,x3,dt0,dt1,dt2){let t1=(x1-x0)/dt0-(x2-x0)/(dt0+dt1)+(x2-x1)/dt1;let t2=(x2-x1)/dt1-(x3-x1)/(dt1+dt2)+(x3-x2)/dt2;t1*=dt1;t2*=dt1;init(x1,x2,t1,t2);},calc(t){const t2=t*t;return c0+c1*t+c2*t2+c3*t2*t;}};}
class CatmullRomCurve3 {
  constructor(points){this.points=points;}
  getPoint(t,target=new V3()){
    const pts=this.points,l=pts.length;const p=(l-1)*t;let ip=Math.floor(p);let w=p-ip;
    if(w===0&&ip===l-1){ip=l-2;w=1;}
    let p0,p3;
    p0=ip>0?pts[ip-1]:new V3().subVectors(pts[0],pts[1]).add(pts[0]);
    const p1=pts[ip],p2=pts[ip+1];
    p3=ip+2<l?pts[ip+2]:new V3().subVectors(pts[l-1],pts[l-2]).add(pts[l-1]);
    const pw=0.25;let dt0=Math.pow(p0.distanceToSquared(p1),pw),dt1=Math.pow(p1.distanceToSquared(p2),pw),dt2=Math.pow(p2.distanceToSquared(p3),pw);
    if(dt1<1e-4)dt1=1;if(dt0<1e-4)dt0=dt1;if(dt2<1e-4)dt2=dt1;
    const px=cubicPoly(),py=cubicPoly(),pz=cubicPoly();
    px.initNonuniformCatmullRom(p0.x,p1.x,p2.x,p3.x,dt0,dt1,dt2);py.initNonuniformCatmullRom(p0.y,p1.y,p2.y,p3.y,dt0,dt1,dt2);pz.initNonuniformCatmullRom(p0.z,p1.z,p2.z,p3.z,dt0,dt1,dt2);
    return target.set(px.calc(w),py.calc(w),pz.calc(w));
  }
}
const real = { Vector3:V3, Vector2:class{constructor(){this.x=0;this.y=0;}}, Color:Col, Object3D:Obj, Group:class extends Obj{}, Mesh, Scene:class extends Obj{},
  CatmullRomCurve3,
  Raycaster:class{constructor(){this.ray={intersectPlane(pl,hit){hit.set(0,0,-5);return hit;}};} setFromCamera(){}},
  Plane:class{}, Clock:class{getDelta(){return 1/60;}},
  MathUtils:{lerp:(a,b,t)=>a+(b-a)*t},
  PerspectiveCamera:class extends Obj{constructor(){super();this.aspect=1;} updateProjectionMatrix(){} lookAt(){}} };
const THREE = new Proxy(real, { get(t, n){ if (n in t) return t[n];
  if (typeof n==='string' && /Geometry$/.test(n)) return class extends Geo{};
  if (typeof n==='string' && /Material$/.test(n)) return Mat;
  if (typeof n==='string' && /Light$/.test(n)) return class extends Obj{};
  if (typeof n==='string' && /^[A-Z]/.test(n)) return class extends Obj{};
  return 10; } });

// ---------- fake timers / DOM ----------
let now = 100000; const timers = []; let tid = 1;
const fakeSetTimeout=(fn,ms=0)=>{const id=tid++;timers.push({id,at:now+ms,fn});return id;};
const fakeClear=(id)=>{const i=timers.findIndex(t=>t.id===id);if(i>=0)timers.splice(i,1);};
function advance(ms){const end=now+ms;for(;;){timers.sort((a,b)=>a.at-b.at);const t=timers[0];if(!t||t.at>end)break;timers.shift();now=Math.max(now,t.at);t.fn();}now=end;}
const el=()=>new Proxy({style:{},classList:{add(){},remove(){}},textContent:'',_t:0,addEventListener(){},appendChild(){}}, {get:(t,n)=>n in t?t[n]:undefined,set:(t,n,v)=>{t[n]=v;return true;}});
const ctx = vm.createContext({
  THREE, console, navigator:{vibrate(){}}, performance:{now:()=>now}, setTimeout:fakeSetTimeout, clearTimeout:fakeClear,
  document:{getElementById:()=>el(),documentElement:{}}, innerWidth:390, innerHeight:844, devicePixelRatio:2,
  AudioContext:class{constructor(){this.state='running';this.currentTime=0;this.sampleRate=44100;} resume(){} }, window:{},
  Date, Float32Array,
});
ctx.window = ctx;
ctx.Math = Object.assign(Object.create(Math), { random: mulberry32(1234) });
vm.runInContext(code, ctx, { filename: 'original-game.js' });
const run = (s) => vm.runInContext(s, ctx);
const rng = (seed) => { ctx.Math.random = mulberry32(seed); };

export { run, ctx, advance, counts, rng, THREE, V3, timers, now as _now };
export const setNow = (v) => { now = v; };
export const getNow = () => now;
export function bootScene() {
  run(`
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(54, innerWidth/innerHeight, 0.1, 90);
    camera.position.set(0, 16.8, 15.8);
    const pts = [];
    for (let i = 0; i <= PATH_SEGS; i++) {
      const t = i / PATH_SEGS; const a = t * Math.PI * 3.6;
      const r = PATH_R * (0.42 + 0.58 * Math.sin(t * Math.PI * 1.6));
      pts.push(new THREE.Vector3(Math.cos(a)*r, 0.50 + Math.sin(t * Math.PI * 5)*0.08, Math.sin(a)*r * 0.92));
    }
    pathCurve = new THREE.CatmullRomCurve3(pts);
    createFrog(); createSkull();
    muted = true;
  `);
}
