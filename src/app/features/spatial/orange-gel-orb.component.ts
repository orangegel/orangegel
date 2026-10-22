import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal
} from '@angular/core';
import * as THREE from 'three';
import { ServerStateKind } from '../../core/bridge/models';
import { WorkspaceStore } from '../../core/state/workspace.store';

const GEL_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    float wave = sin(position.x * 3.5 + uTime * 2.2) * cos(position.y * 3.5 + uTime * 1.8) * 0.08 * uPulse;
    vec3 displaced = position + normal * wave;
    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const GEL_FRAGMENT_SHADER = `
  uniform vec3 uBaseColor;
  uniform vec3 uRimColor;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.4);
    vec3 col = mix(uBaseColor, uRimColor, fresnel * 0.85);
    gl_FragColor = vec4(col, 0.92);
  }
`;

@Component({
  selector: 'og-orange-gel-orb',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      #orbHost
      class="relative inline-flex items-center justify-center overflow-hidden rounded-full"
      [style.width.px]="size"
      [style.height.px]="size"
      [title]="'Server Status: ' + store.serverStatus().state"
    >
      @if (!webglFailed()) {
        <canvas #orbCanvas class="w-full h-full block"></canvas>
      } @else {
        <!-- Clean SVG Hydrogel Orb Fallback when WebGL is unavailable -->
        <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 32 32" class="block">
          <defs>
            <radialGradient id="ogGelGrad" cx="35%" cy="30%" r="65%">
              <stop offset="0%" [attr.stop-color]="fallbackRimHex()" />
              <stop offset="100%" [attr.stop-color]="fallbackBaseHex()" />
            </radialGradient>
          </defs>
          <circle cx="16" cy="16" r="12" fill="url(#ogGelGrad)" />
        </svg>
      }
    </div>
  `
})
export class OrangeGelOrbComponent implements AfterViewInit, OnDestroy {
  readonly store = inject(WorkspaceStore);

  @Input() size = 28;
  @ViewChild('orbHost') orbHost?: ElementRef<HTMLDivElement>;
  @ViewChild('orbCanvas') orbCanvas?: ElementRef<HTMLCanvasElement>;

  readonly webglFailed = signal(false);

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private mesh: THREE.Mesh | null = null;
  private geometry: THREE.SphereGeometry | null = null;
  private rafId: number | null = null;
  private isVisible = true;
  private intersectionObserver: IntersectionObserver | null = null;
  private startTime = performance.now();

  constructor() {
    effect(() => {
      const state = this.store.serverStatus().state;
      this.applyStateUniforms(state);
    });
  }

  fallbackBaseHex(): string {
    const state = this.store.serverStatus().state;
    if (state === 'running') return '#FF7A18';
    if (state === 'starting' || state === 'deploying') return '#FFB347';
    if (state === 'died') return '#EF4444';
    return '#D97706';
  }

  fallbackRimHex(): string {
    const state = this.store.serverStatus().state;
    if (state === 'running') return '#FFF3B0';
    if (state === 'died') return '#FCA5A5';
    return '#FDE68A';
  }

  ngAfterViewInit(): void {
    const canvas = this.orbCanvas?.nativeElement;
    if (!canvas) {
      this.webglFailed.set(true);
      return;
    }

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power'
      });
      this.renderer.setSize(this.size, this.size);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
      this.camera.position.z = 2.6;

      this.geometry = new THREE.SphereGeometry(0.88, 28, 28);
      this.material = new THREE.ShaderMaterial({
        vertexShader: GEL_VERTEX_SHADER,
        fragmentShader: GEL_FRAGMENT_SHADER,
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uPulse: { value: 1.0 },
          uBaseColor: { value: new THREE.Color('#FF7A18') },
          uRimColor: { value: new THREE.Color('#FFE082') }
        }
      });

      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.scene.add(this.mesh);
      this.applyStateUniforms(this.store.serverStatus().state);

      if (typeof IntersectionObserver !== 'undefined' && this.orbHost?.nativeElement) {
        this.intersectionObserver = new IntersectionObserver((entries) => {
          this.isVisible = entries.some((e) => e.isIntersecting);
        });
        this.intersectionObserver.observe(this.orbHost.nativeElement);
      }

      const animate = (now: number) => {
        this.rafId = requestAnimationFrame(animate);
        if (!this.isVisible || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
          return;
        }
        if (this.material && this.mesh && this.renderer && this.scene && this.camera) {
          this.material.uniforms['uTime'].value = (now - this.startTime) * 0.001;
          this.mesh.rotation.y += 0.01;
          this.renderer.render(this.scene, this.camera);
        }
      };
      this.rafId = requestAnimationFrame(animate);
    } catch {
      this.webglFailed.set(true);
    }
  }

  private applyStateUniforms(state: ServerStateKind): void {
    if (!this.material) return;
    switch (state) {
      case 'running':
        this.material.uniforms['uBaseColor'].value.set('#FF7A18');
        this.material.uniforms['uRimColor'].value.set('#FFF59D');
        this.material.uniforms['uPulse'].value = 1.3;
        break;
      case 'starting':
      case 'deploying':
        this.material.uniforms['uBaseColor'].value.set('#FFB347');
        this.material.uniforms['uRimColor'].value.set('#FFFFFF');
        this.material.uniforms['uPulse'].value = 2.1;
        break;
      case 'died':
        this.material.uniforms['uBaseColor'].value.set('#DC2626');
        this.material.uniforms['uRimColor'].value.set('#FCA5A5');
        this.material.uniforms['uPulse'].value = 2.5;
        break;
      default:
        this.material.uniforms['uBaseColor'].value.set('#B45309');
        this.material.uniforms['uRimColor'].value.set('#FCD34D');
        this.material.uniforms['uPulse'].value = 0.65;
        break;
    }
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.intersectionObserver?.disconnect();
    this.geometry?.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
  }
}
