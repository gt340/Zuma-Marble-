// A STRICT stand-in for Three.js r160 used ONLY by tests/browser.mjs. It implements just the API surface the game calls;
// calling anything else throws. It does NOT render pixels, so it cannot validate real WebGL output or exact Three.js semantics.
export const AdditiveBlending = 2, NormalBlending = 1, DoubleSide = 2, SRGBColorSpace = 'srgb', ACESFilmicToneMapping = 4;
export const stats = { liveGeo: 0, liveMat: 0, renders: 0, meshes: 0, geometries: 0, materials: 0, disposed: 0, lastInstanceCounts: [], instanceMatrixUploads: 0 };
if (typeof window !== 'undefined') window.__threeStats = stats;
class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } setScalar(s) { this.x = this.y = this.z = s; return this; } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } }
export { V as Vector3 };
export class Color { constructor(h = 0xffffff) { this.hex = h; this.r = this.g = this.b = 1; } setHex(h) { this.hex = h; return this; } set(h) { this.hex = h; return this; } setHSL() { return this; } setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; } copy(c) { this.hex = c.hex; return this; } }
export class Object3D {
  constructor() { this.position = new V(); this.rotation = Object.assign(new V(), { set: (x, y, z) => { this.rotation.x = x; this.rotation.y = y; this.rotation.z = z; } }); this.scale = new V(1, 1, 1); this.children = []; this.visible = true; this.name = ''; this.userData = {}; this.matrix = {}; this.parent = null; this.renderOrder = 0; }
  add(...o) { for (const c of o) { if (!(c instanceof Object3D)) throw new Error('add: not an Object3D'); this.children.push(c); c.parent = this; } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
  clear() { for (const c of this.children) c.parent = null; this.children.length = 0; return this; }
  getObjectByName(n) { if (this.name === n) return this; for (const c of this.children) { const r = c.getObjectByName(n); if (r) return r; } return undefined; }
  traverse(f) { f(this); for (const c of this.children) c.traverse(f); }
  updateMatrix() { this.matrix = { p: [this.position.x, this.position.y, this.position.z], s: this.scale.x }; }
  lookAt() { }
  getWorldPosition(v) { if (!(v instanceof V)) throw new Error('getWorldPosition needs a Vector3'); return v.set(this.position.x, this.position.y, this.position.z); }
}
export class Scene extends Object3D { constructor() { super(); this.background = null; this.fog = null; this.environment = null; } }
export class Group extends Object3D { }
class Geo { constructor() { stats.geometries++; stats.liveGeo++; } dispose() { if (!this._d) { this._d = 1; stats.liveGeo--; } stats.disposed++; } rotateX() { return this; } setAttribute() { return this; } setIndex() { return this; } computeVertexNormals() { } }
export class SphereGeometry extends Geo { } export class PlaneGeometry extends Geo { } export class CylinderGeometry extends Geo { } export class BoxGeometry extends Geo { } export class TorusGeometry extends Geo { }
export class RingGeometry extends Geo { } export class CircleGeometry extends Geo { } export class ConeGeometry extends Geo { } export class OctahedronGeometry extends Geo { }
export class BufferGeometry extends Geo { } export class BufferAttribute { constructor(a, n) { if (!(a && a.length) || !n) throw new Error('BufferAttribute needs array,itemSize'); this.array = a; this.itemSize = n; } }
class Mat { constructor(p = {}) { stats.materials++; stats.liveMat++; this.color = new Color(p.color); this.emissive = new Color(p.emissive); this.opacity = p.opacity ?? 1; this.emissiveIntensity = p.emissiveIntensity ?? 1; Object.assign(this, p); this.color = new Color(p.color); this.emissive = new Color(p.emissive); } dispose() { if (!this._d) { this._d = 1; stats.liveMat--; } stats.disposed++; } }
export class MeshStandardMaterial extends Mat { } export class MeshBasicMaterial extends Mat { } export class PointsMaterial extends Mat { } export class SpriteMaterial extends Mat { }
export class Mesh extends Object3D { constructor(g, m) { super(); if (!g || !m) throw new Error('Mesh needs geometry+material'); this.geometry = g; this.material = m; stats.meshes++; } }
export class Sprite extends Object3D { constructor(m) { super(); this.material = m; } }
export class Points extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
export class InstancedMesh extends Mesh {
  constructor(g, m, n) { super(g, m); this.count = n; this.capacity = n; this.instanceColor = null; this.instanceMatrix = { needsUpdate: false }; }
  setMatrixAt(i, mat) { if (i >= this.capacity) throw new Error('instance index out of range'); if (!mat || !mat.p) throw new Error('setMatrixAt needs a matrix'); }
  setColorAt(i, c) { if (i >= this.capacity) throw new Error('instance index out of range'); if (!(c instanceof Color)) throw new Error('setColorAt needs Color'); if (!this.instanceColor) this.instanceColor = { needsUpdate: false }; }
  dispose() { stats.disposed++; }
}
export class DirectionalLight extends Object3D { constructor(c, i) { super(); this.color = new Color(c); this.intensity = i; } }
export class HemisphereLight extends Object3D { constructor(a, b, i) { super(); this.intensity = i; } }
export class FogExp2 { constructor(c, d) { this.color = new Color(c); this.density = d; } }
export class PerspectiveCamera extends Object3D { constructor(f, a, n, fa) { super(); this.fov = f; this.aspect = a; this.near = n; this.far = fa; } updateProjectionMatrix() { } }
export class CanvasTexture { constructor(cv) { if (!cv || !cv.getContext) throw new Error('CanvasTexture needs canvas'); this.colorSpace = ''; } dispose() { stats.disposed++; } }
export class PMREMGenerator { constructor(r) { this.r = r; } fromScene(s, sigma) { if (!(s instanceof Scene)) throw new Error('fromScene needs Scene'); return { texture: { isTexture: true } }; } dispose() { } }
export class WebGLRenderer {
  constructor(o) { this.domElement = document.createElement('canvas'); this.toneMapping = 0; this.toneMappingExposure = 1; this.w = 0; this.h = 0; this.pr = 1; }
  setPixelRatio(r) { this.pr = r; } setSize(w, h, upd) { this.w = w; this.h = h; this.domElement.width = Math.floor(w * this.pr); this.domElement.height = Math.floor(h * this.pr); if (upd !== false) { this.domElement.style.width = w + 'px'; this.domElement.style.height = h + 'px'; } }
  render(scene, camera) {
    if (!(scene instanceof Scene) || !(camera instanceof PerspectiveCamera)) throw new Error('render(scene,camera)');
    stats.renders++; stats.lastInstanceCounts = scene.children.filter(c => c instanceof InstancedMesh).map(c => c.count);
    const cx = this.domElement.getContext('2d'); if (cx) { cx.fillStyle = '#14102a'; cx.fillRect(0, 0, this.domElement.width, this.domElement.height); }
  }
  dispose() { }
}
