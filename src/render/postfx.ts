import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { BLOOM_LAYER } from "./bloomLayer.ts";

export interface PostFX {
  render(camera: THREE.Camera): void;
  resize(width: number, height: number): void;
}

/**
 * Selective bloom: a first pass renders only the emissive bloom-layer objects
 * (signal lamps, crossing lights, headlights) on a black background and blurs
 * them; a second pass renders the full scene and adds the blurred lights back
 * in, then tone-maps. This way bright daytime sky/ground never bloom.
 */
export function setupPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostFX {
  const bloomRender = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.4, 0.5, 0);
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(bloomRender);
  bloomComposer.addPass(bloomPass);

  const mixPass = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloomComposer.renderTarget2.texture },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }`,
    }),
    "baseTexture",
  );
  mixPass.needsSwap = true;

  const sceneRender = new RenderPass(scene, camera);
  const finalComposer = new EffectComposer(renderer);
  finalComposer.addPass(sceneRender);
  finalComposer.addPass(mixPass);
  finalComposer.addPass(new OutputPass());

  return {
    render(cam: THREE.Camera): void {
      bloomRender.camera = cam;
      sceneRender.camera = cam;

      // Bloom pass: emissive layer only, on a black background.
      const bg = scene.background;
      scene.background = null;
      cam.layers.set(BLOOM_LAYER);
      bloomComposer.render();
      cam.layers.set(0);
      scene.background = bg;

      finalComposer.render();
    },
    resize(width: number, height: number): void {
      const ratio = Math.min(window.devicePixelRatio, 2);
      bloomComposer.setPixelRatio(ratio);
      finalComposer.setPixelRatio(ratio);
      bloomComposer.setSize(width, height);
      finalComposer.setSize(width, height);
    },
  };
}
