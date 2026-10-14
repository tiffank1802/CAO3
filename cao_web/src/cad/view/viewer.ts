/**
 * Vue 3D (three.js) : affichage du maillage, arêtes, pré-sélection et sélection.
 *
 * Le maillage est un cache jetable : la table `faceIds`/`edgeIds` fournie par le noyau
 * est le seul pont entre le picking à l'écran et le B-Rep (principe P7).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MeshPayload } from "../kernel/protocol";

export type ViewName = "iso" | "front" | "top" | "right";
export type ViewStyle = "shaded-edges" | "shaded" | "wireframe" | "transparent";

export interface PickedSelection {
  kind: "face" | "edge";
  id: number;
  label: string;
}

export interface ViewerCallbacks {
  onSelect?: (selection: PickedSelection | null) => void;
  onHover?: (selection: PickedSelection | null) => void;
}

export class CadViewer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private grid: THREE.GridHelper;
  private axes: THREE.AxesHelper;
  private bodyMesh: THREE.Mesh | null = null;
  private bodyMaterial: THREE.MeshStandardMaterial;
  private edgeLines: THREE.LineSegments | null = null;
  private highlightMesh: THREE.Mesh;
  private preHighlightMesh: THREE.Mesh;
  private payload: MeshPayload | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-10, -10);
  private callbacks: ViewerCallbacks = {};
  private animationFrame = 0;
  private needsRender = true;
  private style: ViewStyle = "shaded-edges";
  private disposed = false;
  private hasFramed = false;

  constructor(container: HTMLElement, callbacks: ViewerCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x1d2129, 1);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1d2129);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 20000);
    this.camera.up.set(0, 0, 1); // convention CAO : Z vers le haut
    this.camera.position.set(180, -220, 160);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener("change", () => this.requestRender());

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(200, -260, 400);
    const fill = new THREE.DirectionalLight(0x9fb6ff, 0.35);
    fill.position.set(-300, 200, -180);
    this.scene.add(ambient, key, fill);

    this.grid = new THREE.GridHelper(400, 40, 0x3d444f, 0x2b3038);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = -0.02;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(40);
    this.scene.add(this.axes);

    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9c3cf,
      metalness: 0.15,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });

    const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0x39d353, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    this.highlightMesh = new THREE.Mesh(new THREE.BufferGeometry(), highlightMaterial);
    this.highlightMesh.renderOrder = 3;
    const preMaterial = new THREE.MeshBasicMaterial({ color: 0xffa726, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    this.preHighlightMesh = new THREE.Mesh(new THREE.BufferGeometry(), preMaterial);
    this.preHighlightMesh.renderOrder = 2;
    this.scene.add(this.highlightMesh, this.preHighlightMesh);

    this.raycaster.params.Line = { threshold: 1.2 };
    this.raycaster.params.Points = { threshold: 1.2 };

    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("resize", this.handleResize);
    this.loop();
  }

  private requestRender(): void {
    this.needsRender = true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.loop);
    this.controls.update();
    if (this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  };

  private handleResize = (): void => {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 0) return;
    const picked = this.pick(event);
    if (picked?.kind === "edge" || picked?.kind === "face") this.callbacks.onHover?.(picked);
    else this.callbacks.onHover?.(null);
    this.setPreHighlight(picked);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointerup", up);
      const moved = Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY);
      if (moved > 4) return; // rotation/panoramique, pas une sélection
      const picked = this.pick(upEvent);
      this.setHighlight(picked);
      this.callbacks.onSelect?.(picked);
    };
    window.addEventListener("pointerup", up);
  };

  private updateRaycaster(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pick(event: PointerEvent): PickedSelection | null {
    if (!this.payload) return null;
    this.updateRaycaster(event);
    const edgeHits = this.edgeLines ? this.raycaster.intersectObject(this.edgeLines, false) : [];
    const bodyHits = this.bodyMesh ? this.raycaster.intersectObject(this.bodyMesh, false) : [];
    const edgeHit = edgeHits[0];
    const bodyHit = bodyHits[0];
    if (edgeHit && (!bodyHit || edgeHit.distance <= bodyHit.distance + 2)) {
      const segmentIndex = Math.floor((edgeHit.index ?? 0) / 2);
      const edgeId = this.payload.edgeIds[segmentIndex];
      if (edgeId !== undefined) return { kind: "edge", id: edgeId, label: `Arête #${edgeId}` };
    }
    if (bodyHit && bodyHit.faceIndex !== undefined && bodyHit.faceIndex !== null) {
      const faceId = this.payload.faceIds[bodyHit.faceIndex];
      if (faceId !== undefined) return { kind: "face", id: faceId, label: `Face #${faceId}` };
    }
    return null;
  }

  private geometryForTriangles(triangles: number[], positions: Float32Array): THREE.BufferGeometry {
    const vertexPositions = new Float32Array(triangles.length * 3);
    for (let i = 0; i < triangles.length; i += 1) {
      const vertexIndex = triangles[i];
      vertexPositions[i * 3] = positions[vertexIndex * 3];
      vertexPositions[i * 3 + 1] = positions[vertexIndex * 3 + 1];
      vertexPositions[i * 3 + 2] = positions[vertexIndex * 3 + 2];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertexPositions, 3));
    return geometry;
  }

  private trianglesOfFace(faceId: number): number[] {
    if (!this.payload) return [];
    const result: number[] = [];
    const indices = this.payload.indices;
    for (let tri = 0; tri < this.payload.faceIds.length; tri += 1) {
      if (this.payload.faceIds[tri] === faceId) {
        result.push(indices[tri * 3], indices[tri * 3 + 1], indices[tri * 3 + 2]);
      }
    }
    return result;
  }

  private setHighlight(selection: PickedSelection | null): void {
    if (!this.payload || !selection || selection.kind !== "face") {
      this.highlightMesh.geometry.dispose();
      this.highlightMesh.geometry = new THREE.BufferGeometry();
      this.requestRender();
      return;
    }
    const triangles = this.trianglesOfFace(selection.id);
    this.highlightMesh.geometry.dispose();
    this.highlightMesh.geometry = this.geometryForTriangles(triangles, this.payload.positions);
    this.requestRender();
  }

  private setPreHighlight(selection: PickedSelection | null): void {
    if (!this.payload || !selection || selection.kind !== "face") {
      this.preHighlightMesh.geometry.dispose();
      this.preHighlightMesh.geometry = new THREE.BufferGeometry();
      this.requestRender();
      return;
    }
    const triangles = this.trianglesOfFace(selection.id);
    this.preHighlightMesh.geometry.dispose();
    this.preHighlightMesh.geometry = this.geometryForTriangles(triangles, this.payload.positions);
    this.requestRender();
  }

  setMesh(payload: MeshPayload | null): void {
    this.disposeBody();
    this.payload = payload;
    if (!payload || payload.triangleCount === 0) {
      this.requestRender();
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(payload.positions, 3));
    if (payload.normals.length === payload.positions.length) {
      geometry.setAttribute("normal", new THREE.BufferAttribute(payload.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    geometry.setIndex(new THREE.BufferAttribute(payload.indices, 1));
    geometry.computeBoundingSphere();

    this.bodyMesh = new THREE.Mesh(geometry, this.bodyMaterial);
    this.scene.add(this.bodyMesh);

    if (payload.edgeLines.length) {
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute("position", new THREE.BufferAttribute(payload.edgeLines, 3));
      const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x10151c });
      this.edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      this.edgeLines.renderOrder = 1;
      this.scene.add(this.edgeLines);
    }

    this.applyStyle();
    if (!this.hasFramed && payload.bbox) {
      this.frameAll();
      this.hasFramed = true;
    }
    this.requestRender();
  }

  private disposeBody(): void {
    if (this.bodyMesh) {
      this.scene.remove(this.bodyMesh);
      this.bodyMesh.geometry.dispose();
      this.bodyMesh = null;
    }
    if (this.edgeLines) {
      this.scene.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      this.edgeLines = null;
    }
    this.setHighlight(null);
    this.setPreHighlight(null);
  }

  setStyle(style: ViewStyle): void {
    this.style = style;
    this.applyStyle();
    this.requestRender();
  }

  private applyStyle(): void {
    if (!this.bodyMesh) return;
    switch (this.style) {
      case "shaded":
        this.bodyMaterial.transparent = false;
        this.bodyMaterial.opacity = 1;
        this.bodyMaterial.wireframe = false;
        if (this.edgeLines) this.edgeLines.visible = false;
        break;
      case "shaded-edges":
        this.bodyMaterial.transparent = false;
        this.bodyMaterial.opacity = 1;
        this.bodyMaterial.wireframe = false;
        if (this.edgeLines) this.edgeLines.visible = true;
        break;
      case "wireframe":
        this.bodyMaterial.wireframe = true;
        this.bodyMaterial.transparent = false;
        this.bodyMaterial.opacity = 1;
        if (this.edgeLines) this.edgeLines.visible = false;
        break;
      case "transparent":
        this.bodyMaterial.wireframe = false;
        this.bodyMaterial.transparent = true;
        this.bodyMaterial.opacity = 0.42;
        if (this.edgeLines) this.edgeLines.visible = true;
        break;
    }
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
    this.axes.visible = visible;
    this.requestRender();
  }

  setView(view: ViewName): void {
    const distance = this.radius() * 2.6;
    const target = this.controls.target.clone();
    switch (view) {
      case "front":
        this.camera.position.set(target.x, target.y - distance, target.z);
        break;
      case "top":
        this.camera.position.set(target.x, target.y, target.z + distance);
        break;
      case "right":
        this.camera.position.set(target.x + distance, target.y, target.z);
        break;
      case "iso":
      default:
        this.camera.position.set(target.x + distance * 0.75, target.y - distance * 0.75, target.z + distance * 0.6);
        break;
    }
    this.camera.lookAt(target);
    this.controls.update();
    this.requestRender();
  }

  private radius(): number {
    if (!this.payload || !this.payload.triangleCount) return 120;
    const { min, max } = this.payload.bbox;
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    return Math.max(size, 20);
  }

  frameAll(): void {
    if (!this.payload || !this.payload.triangleCount) {
      this.controls.target.set(0, 0, 0);
      this.setView("iso");
      return;
    }
    const { min, max } = this.payload.bbox;
    const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    this.controls.target.copy(center);
    this.setView("iso");
    this.camera.position.add(center);
    this.camera.lookAt(center);
    this.controls.update();
    this.requestRender();
  }

  capturePng(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.handleResize);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.disposeBody();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
