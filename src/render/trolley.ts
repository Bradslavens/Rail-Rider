import * as THREE from "three";

export interface TrolleyMesh {
  group: THREE.Group;
  setColor: (colorHex: string) => void;
}

/**
 * A stylised light-rail vehicle pointing along +Z (forward): a liveried body
 * with a wraparound window band, an inset roof with a pantograph, an underframe
 * skirt over two bogies, and emissive head/tail lights. `setColor` repaints the
 * body so it matches the current line.
 */
export function buildTrolley(colorHex: string): TrolleyMesh {
  const group = new THREE.Group();
  const LEN = 23;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    roughness: 0.45,
    metalness: 0.15,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0d141c,
    roughness: 0.15,
    metalness: 0.4,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1f25, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c7, roughness: 0.6, metalness: 0.3 });

  // Main body.
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, LEN), bodyMat);
  body.position.y = 2.0;
  group.add(body);

  // Window band wrapping the sides (slightly proud of the body).
  const windows = new THREE.Mesh(new THREE.BoxGeometry(2.64, 0.95, LEN - 3), glassMat);
  windows.position.y = 2.55;
  group.add(windows);

  // Inset roof.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, LEN - 1.5), roofMat);
  roof.position.y = 3.45;
  group.add(roof);

  // Underframe skirt.
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.7, LEN - 0.5), darkMat);
  skirt.position.y = 0.75;
  group.add(skirt);

  // Bogies under each end.
  for (const z of [LEN / 2 - 3.5, -(LEN / 2 - 3.5)]) {
    const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 3.2), darkMat);
    bogie.position.set(0, 0.45, z);
    group.add(bogie);
  }

  // Pantograph on the roof.
  const panMat = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.6, metalness: 0.5 });
  for (const dz of [-0.7, 0.7]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), panMat);
    arm.position.set(0, 4.2, dz);
    arm.rotation.x = (dz > 0 ? 1 : -1) * 0.5;
    group.add(arm);
  }
  const panBar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.08), panMat);
  panBar.position.set(0, 4.85, 0);
  group.add(panBar);

  // Windshields at both ends.
  for (const z of [LEN / 2 - 0.1, -(LEN / 2 - 0.1)]) {
    const ws = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 0.2), glassMat);
    ws.position.set(0, 2.5, z);
    group.add(ws);
  }

  // Head/tail lights.
  const head = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe08a, emissiveIntensity: 1.2 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xff4040, emissive: 0xff2020, emissiveIntensity: 1.0 });
  for (const dx of [-0.9, 0.9]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.25), head);
    h.position.set(dx, 1.1, LEN / 2 + 0.05);
    group.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.25), tail);
    t.position.set(dx, 1.1, -(LEN / 2 + 0.05));
    group.add(t);
  }

  return {
    group,
    setColor: (hex: string) => bodyMat.color.set(hex),
  };
}
