import * as THREE from "three";
import type { PlacedSignal, SignalAspect } from "../core/types.ts";

const ASPECT_COLOR: Record<SignalAspect, number> = {
  red: 0xff2a2a,
  yellow: 0xf5c518,
  green: 0x2ecc52,
};

const MAST_HEIGHT = 6;

/**
 * Build a group of wayside signals: a dark mast with a single illuminated
 * aspect lamp at the top, positioned and oriented per signal. The shared mast
 * material and per-aspect lamp materials are reused across all signals.
 */
export function buildSignals(placed: PlacedSignal[]): THREE.Group {
  const group = new THREE.Group();
  if (placed.length === 0) return group;

  const mastMat = new THREE.MeshStandardMaterial({ color: 0x2a323c, roughness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x12161c, roughness: 0.6 });
  const lampMats: Record<SignalAspect, THREE.MeshStandardMaterial> = {
    red: lamp("red"),
    yellow: lamp("yellow"),
    green: lamp("green"),
  };

  const mastGeo = new THREE.CylinderGeometry(0.15, 0.18, MAST_HEIGHT, 8);
  const headGeo = new THREE.BoxGeometry(0.9, 1.6, 0.6);
  const lampGeo = new THREE.SphereGeometry(0.32, 12, 12);

  for (const s of placed) {
    const sig = new THREE.Group();
    sig.position.set(s.x, 0, s.z);
    sig.rotation.y = s.headingRad;

    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.y = MAST_HEIGHT / 2;
    sig.add(mast);

    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = MAST_HEIGHT;
    sig.add(head);

    const lamp = new THREE.Mesh(lampGeo, lampMats[s.aspect]);
    lamp.position.set(0, MAST_HEIGHT, 0.4); // on the face that looks at the train
    sig.add(lamp);

    group.add(sig);
  }
  return group;
}

function lamp(aspect: SignalAspect): THREE.MeshStandardMaterial {
  const color = ASPECT_COLOR[aspect];
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.1,
  });
}
