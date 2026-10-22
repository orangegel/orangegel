import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal
} from '@angular/core';
import * as THREE from 'three';
import { SiteGraphNode, SiteNodeStatus } from '../../core/bridge/models';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { OgLucideIconsModule } from '../../shared/icons/lucide-icons.module';

@Component({
  selector: 'og-site-graph-3d',
  standalone: true,
  imports: [CommonModule, OgLucideIconsModule],
  template: `
    <!-- WebKit Layout Rule: relative flex-1 min-h-0 / absolute inset-0 -->
    <div #graphHost class="relative w-full h-full bg-og-bg overflow-hidden select-none">
      @if (!webglFailed()) {
        <canvas
          #graphCanvas
          (click)="onCanvasClick($event)"
          (mousemove)="onCanvasHover($event)"
          class="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing block"
        ></canvas>
      } @else {
        <!-- Accessible 2D Constellation Fallback if WebGL is unavailable -->
        <div class="absolute inset-0 p-6 overflow-auto flex flex-col gap-3">
          <div class="text-xs text-og-citrus font-semibold">
            Site Topology Graph (Interactive Node Directory)
          </div>
          <div class="grid grid-cols-2 gap-2">
            @for (node of store.siteGraph().nodes; track node.id) {
              <button
                type="button"
                (click)="activateNode(node)"
                class="p-3 rounded-lg bg-og-panel border border-og-border hover:border-og-amber text-left flex items-center justify-between"
              >
                <div>
                  <div class="text-xs font-semibold text-og-text">{{ node.label }}</div>
                  <div class="text-[11px] font-mono text-og-muted">{{ node.route }}</div>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] uppercase bg-og-bg text-og-citrus">
                  {{ node.status }}
                </span>
              </button>
            }
          </div>
        </div>
      }

      <!-- Legend & Hovered Node HUD Overlay -->
      <div class="absolute top-3 left-3 bg-og-surface/90 backdrop-blur-md border border-og-border rounded-lg p-2.5 text-[11px] space-y-1.5 pointer-events-none">
        <div class="font-semibold text-og-citrus flex items-center gap-1.5">
          <lucide-icon name="orbit" class="w-3.5 h-3.5 text-og-amber"></lucide-icon>
          3D Site Topology Constellation
        </div>
        <div class="flex items-center gap-3 text-[10px] text-og-muted">
          <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-full bg-[#FF7A18] inline-block"></i> Published</span>
          <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-full bg-[#FBBF24] inline-block"></i> Draft</span>
          <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-full bg-[#38BDF8] inline-block"></i> Section</span>
          <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-full bg-[#A855F7] inline-block"></i> Taxonomy</span>
          <span class="flex items-center gap-1"><i class="w-2 h-2 rounded-full bg-[#EF4444] inline-block"></i> Broken Link</span>
        </div>
      </div>

      <!-- Interactive Node Quick-Jump Pill Strip -->
      <div class="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 bg-og-surface/90 backdrop-blur-md border border-og-border rounded-lg px-3 py-2 text-xs">
        <div class="flex items-center gap-2 overflow-x-auto">
          @for (node of store.siteGraph().nodes; track node.id) {
            <button
              type="button"
              (click)="activateNode(node)"
              class="px-2 py-1 rounded bg-og-panel hover:bg-og-amber/20 border border-og-border hover:border-og-amber/50 text-[11px] flex items-center gap-1.5 transition shrink-0"
            >
              <span
                class="w-2 h-2 rounded-full"
                [style.backgroundColor]="statusColorHex(node.status)"
              ></span>
              <span>{{ node.label }}</span>
            </button>
          }
        </div>
        @if (hoveredNode(); as hovered) {
          <span class="text-[11px] font-mono text-og-citrus">
            {{ hovered.relPath }} → {{ hovered.route }}
          </span>
        }
      </div>
    </div>
  `
})
export class SiteGraph3DComponent implements AfterViewInit, OnDestroy {
  readonly store = inject(WorkspaceStore);

  @ViewChild('graphHost') graphHost?: ElementRef<HTMLDivElement>;
  @ViewChild('graphCanvas') graphCanvas?: ElementRef<HTMLCanvasElement>;

  readonly webglFailed = signal(false);
  readonly hoveredNode = signal<SiteGraphNode | null>(null);

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private group: THREE.Group | null = null;
  private nodeMeshes = new Map<THREE.Object3D, SiteGraphNode>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const graph = this.store.siteGraph();
      if (this.scene && graph) {
        this.rebuildConstellation();
      }
    });
  }

  statusColorHex(status: SiteNodeStatus): string {
    switch (status) {
      case 'published':
        return '#FF7A18';
      case 'draft':
        return '#FBBF24';
      case 'section':
        return '#38BDF8';
      case 'taxonomy':
        return '#A855F7';
      case 'broken-link':
        return '#EF4444';
    }
  }

  ngAfterViewInit(): void {
    const canvas = this.graphCanvas?.nativeElement;
    const host = this.graphHost?.nativeElement;
    if (!canvas || !host) {
      this.webglFailed.set(true);
      return;
    }

    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      const rect = host.getBoundingClientRect();
      const w = Math.max(320, rect.width);
      const h = Math.max(240, rect.height);
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
      this.camera.position.set(0, 1.5, 9.5);
      this.camera.lookAt(0, 0, 0);

      const ambient = new THREE.AmbientLight('#ffffff', 0.8);
      const point = new THREE.PointLight('#FF9238', 2.4, 30);
      point.position.set(4, 6, 6);
      this.scene.add(ambient, point);

      this.group = new THREE.Group();
      this.scene.add(this.group);
      this.rebuildConstellation();

      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const nw = Math.max(200, entry.contentRect.width);
            const nh = Math.max(200, entry.contentRect.height);
            if (this.renderer && this.camera) {
              this.renderer.setSize(nw, nh);
              this.camera.aspect = nw / nh;
              this.camera.updateProjectionMatrix();
            }
          }
        });
        this.resizeObserver.observe(host);
      }

      const animate = () => {
        this.rafId = requestAnimationFrame(animate);
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        if (this.group && this.renderer && this.scene && this.camera) {
          this.group.rotation.y += 0.0025;
          this.renderer.render(this.scene, this.camera);
        }
      };
      this.rafId = requestAnimationFrame(animate);
    } catch {
      this.webglFailed.set(true);
    }
  }

  private rebuildConstellation(): void {
    if (!this.group) return;
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
    }
    this.nodeMeshes.clear();

    const { nodes, edges } = this.store.siteGraph();
    const positions = new Map<string, THREE.Vector3>();
    const count = Math.max(1, nodes.length);

    nodes.forEach((node, idx) => {
      const angle = (idx / count) * Math.PI * 2;
      const radius = idx === 0 ? 0 : 3.2;
      const yOffset = ((idx % 3) - 1) * 1.1;
      const pos = new THREE.Vector3(
        Math.cos(angle) * radius,
        yOffset,
        Math.sin(angle) * radius
      );
      positions.set(node.id, pos);

      const geom = new THREE.SphereGeometry(node.status === 'section' ? 0.36 : 0.28, 20, 20);
      const mat = new THREE.MeshStandardMaterial({
        color: this.statusColorHex(node.status),
        emissive: this.statusColorHex(node.status),
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.1
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      this.group!.add(mesh);
      this.nodeMeshes.set(mesh, node);
    });

    edges.forEach((edge) => {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      if (!a || !b) return;
      const lineGeom = new THREE.BufferGeometry().setFromPoints([a, b]);
      const lineMat = new THREE.LineBasicMaterial({
        color: edge.broken ? '#EF4444' : '#475569'
      });
      const line = new THREE.Line(lineGeom, lineMat);
      this.group!.add(line);
    });
  }

  onCanvasHover(event: MouseEvent): void {
    const hit = this.raycastNode(event);
    this.hoveredNode.set(hit);
  }

  onCanvasClick(event: MouseEvent): void {
    const hit = this.raycastNode(event);
    if (hit) {
      this.activateNode(hit);
    }
  }

  activateNode(node: SiteGraphNode): void {
    void this.store.openDocument(node.relPath);
    this.store.setPreviewRoute(node.route);
    this.store.setViewportMode('desktop');
  }

  private raycastNode(event: MouseEvent): SiteGraphNode | null {
    const canvas = this.graphCanvas?.nativeElement;
    if (!canvas || !this.camera || !this.group) return null;
    const rect = canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = Array.from(this.nodeMeshes.keys());
    const intersects = this.raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0) {
      return this.nodeMeshes.get(intersects[0].object) ?? null;
    }
    return null;
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
  }
}
