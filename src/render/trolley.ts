import * as THREE from "three";

export interface TrolleyMesh {
  group: THREE.Group;
  setColor: (colorHex: string) => void;
}

/**
 * A simple light-rail-ish trolley: a long body pointing along +Z (its forward
 * axis) with a bright "front" face so heading is visible. Replaced with a real
 * model in Phase 5.
 */
export function buildTrolley(colorHex: string): TrolleyMesh {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    roughness: 0.5,
    metalness: 0.1,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 24), bodyMat);
  body.position.y = 1.9;
  group.add(body);

  // Windshield band near the front.
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 1.0, 1.2),
    new THREE.MeshStandardMaterial({
      color: 0x111820,
      roughness: 0.2,
      metalness: 0.3,
    }),
  );
  windshield.position.set(0, 2.6, 11.6);
  group.add(windshield);

  // Headlights so the leading end reads clearly.
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c0,
    emissive: 0xffe08a,
    emissiveIntensity: 0.8,
  });
  for (const dx of [-0.9, 0.9]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.3), lightMat);
    lamp.position.set(dx, 1.0, 12.05);
    group.add(lamp);
  }

  return {
    group,
    setColor: (hex: string) => bodyMat.color.set(hex),
  };
}
