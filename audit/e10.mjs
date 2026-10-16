import { run, bootScene } from './harness.mjs';
bootScene();
const cam={p:[0,16.8,15.8],t:[0,0.6,0],fov:54};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const l=Math.hypot(...a);return a.map(v=>v/l)};
const f=norm(sub(cam.t,cam.p)),r=norm(cross(f,[0,1,0])),u=cross(r,f);
const proj=(P,aspect)=>{const d=sub(P,cam.p);const z=dot(d,f);const th=Math.tan(cam.fov*Math.PI/360);return[dot(d,r)/(z*th*aspect),dot(d,u)/(z*th)]};
const unproj=(nx,ny,aspect,planeY)=>{const th=Math.tan(cam.fov*Math.PI/360);const dir=norm(f.map((v,i)=>v+r[i]*nx*th*aspect+u[i]*ny*th));const t=(planeY-cam.p[1])/dir[1];return cam.p.map((v,i)=>v+dir[i]*t)};
for (const [name,w,h] of [['portrait 390x844',390,844],['landscape 844x390',844,390],['desktop 1280x720',1280,720]]) {
  const a=w/h; let out=0,N=400; for(let i=0;i<=N;i++){const p=run(`pathCurve.getPoint(${i/N})`);const [x,y]=proj([p.x,p.y,p.z],a);if(Math.abs(x)>1||Math.abs(y)>1)out++;}
  console.log(name,'path points outside view:',(100*out/(N+1)).toFixed(0)+'%');
}
// aim parallax: user taps exactly on a ball at height 0.5; original raycasts to plane y=0
for (const B of [[6,0.5,-4],[-5,0.5,-6],[0,0.5,-7],[5,0.5,4]]) {
  const a=390/844; const [nx,ny]=proj(B,a); const g=unproj(nx,ny,a,0);
  const trueAng=Math.atan2(B[0],B[2]),usedAng=Math.atan2(g[0],g[2]);
  let e=(usedAng-trueAng)*180/Math.PI; const dist=Math.hypot(B[0],B[2]);
  console.log('ball',B.join(','),'aim error',e.toFixed(2)+'°','lateral miss at ball ≈',(Math.abs(e)*Math.PI/180*dist).toFixed(2),'(ball radius 0.48)');
}
