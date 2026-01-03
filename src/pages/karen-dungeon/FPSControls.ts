import * as THREE from 'three';

export interface FPSControlsState {
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  pointerLocked: boolean;
}

/**
 * Desktop FPS controls with pointer lock + WASD
 */
export class DesktopFPSControls {
  private camera: THREE.Camera;
  private domElement: HTMLElement;
  private state: FPSControlsState;
  private euler: THREE.Euler;
  private onShoot: () => void;

  public pitchObject: THREE.Object3D;
  public yawObject: THREE.Object3D;

  constructor(
    camera: THREE.Camera,
    domElement: HTMLElement,
    onShoot: () => void
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.onShoot = onShoot;

    this.state = {
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      pointerLocked: false,
    };

    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

    // Pitch (up/down) object
    this.pitchObject = new THREE.Object3D();
    this.pitchObject.add(camera);

    // Yaw (left/right) object
    this.yawObject = new THREE.Object3D();
    this.yawObject.position.y = 1.6; // Eye height
    this.yawObject.add(this.pitchObject);

    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Pointer lock
    this.domElement.addEventListener('click', () => {
      if (!this.state.pointerLocked) {
        this.domElement.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.state.pointerLocked = document.pointerLockElement === this.domElement;
    });

    // Mouse movement
    document.addEventListener('mousemove', (e) => {
      if (!this.state.pointerLocked) return;

      const sensitivity = 0.002;
      this.yawObject.rotation.y -= e.movementX * sensitivity;
      this.pitchObject.rotation.x -= e.movementY * sensitivity;

      // Clamp pitch
      this.pitchObject.rotation.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, this.pitchObject.rotation.x)
      );
    });

    // Mouse click to shoot
    document.addEventListener('mousedown', (e) => {
      if (this.state.pointerLocked && e.button === 0) {
        this.onShoot();
      }
    });

    // Keyboard
    document.addEventListener('keydown', (e) => this.onKeyChange(e, true));
    document.addEventListener('keyup', (e) => this.onKeyChange(e, false));
  }

  private onKeyChange(e: KeyboardEvent, pressed: boolean) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.state.moveForward = pressed;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.state.moveBackward = pressed;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.state.moveLeft = pressed;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.state.moveRight = pressed;
        break;
      case 'Space':
        if (pressed) this.onShoot();
        break;
    }
  }

  public update(delta: number) {
    const speed = 8 * delta;
    const direction = new THREE.Vector3();

    if (this.state.moveForward) direction.z -= 1;
    if (this.state.moveBackward) direction.z += 1;
    if (this.state.moveLeft) direction.x -= 1;
    if (this.state.moveRight) direction.x += 1;

    direction.normalize();
    direction.applyEuler(new THREE.Euler(0, this.yawObject.rotation.y, 0));

    this.yawObject.position.x += direction.x * speed;
    this.yawObject.position.z += direction.z * speed;

    // Keep Y constant
    this.yawObject.position.y = 1.6;
  }

  public getPosition(): THREE.Vector3 {
    return this.yawObject.position.clone();
  }

  public getDirection(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyQuaternion(this.pitchObject.quaternion);
    dir.applyQuaternion(this.yawObject.quaternion);
    return dir.normalize();
  }

  public isLocked(): boolean {
    return this.state.pointerLocked;
  }

  public dispose() {
    document.exitPointerLock();
  }
}

/**
 * Mobile touch controls with dual virtual joysticks
 */
export class MobileTouchControls {
  private moveStick: { active: boolean; startX: number; startY: number; currentX: number; currentY: number };
  private lookStick: { active: boolean; startX: number; startY: number; currentX: number; currentY: number };
  private yaw: number;
  private pitch: number;
  private position: THREE.Vector3;
  private onShoot: () => void;

  constructor(onShoot: () => void) {
    this.moveStick = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
    this.lookStick = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.position = new THREE.Vector3(0, 1.6, 0);
    this.onShoot = onShoot;
  }

  public handleMoveStart(x: number, y: number) {
    this.moveStick.active = true;
    this.moveStick.startX = x;
    this.moveStick.startY = y;
    this.moveStick.currentX = x;
    this.moveStick.currentY = y;
  }

  public handleMoveMove(x: number, y: number) {
    if (this.moveStick.active) {
      this.moveStick.currentX = x;
      this.moveStick.currentY = y;
    }
  }

  public handleMoveEnd() {
    this.moveStick.active = false;
  }

  public handleLookStart(x: number, y: number) {
    this.lookStick.active = true;
    this.lookStick.startX = x;
    this.lookStick.startY = y;
    this.lookStick.currentX = x;
    this.lookStick.currentY = y;
  }

  public handleLookMove(x: number, y: number) {
    if (this.lookStick.active) {
      this.lookStick.currentX = x;
      this.lookStick.currentY = y;
    }
  }

  public handleLookEnd() {
    this.lookStick.active = false;
  }

  public shoot() {
    this.onShoot();
  }

  public update(delta: number, camera: THREE.Camera) {
    const moveSpeed = 6 * delta;
    const lookSpeed = 2.5 * delta;
    const maxDist = 50;

    // Movement
    if (this.moveStick.active) {
      const dx = this.moveStick.currentX - this.moveStick.startX;
      const dy = this.moveStick.currentY - this.moveStick.startY;

      const moveX = Math.max(-1, Math.min(1, dx / maxDist));
      const moveY = Math.max(-1, Math.min(1, dy / maxDist));

      // Forward/backward
      this.position.x += Math.sin(this.yaw) * -moveY * moveSpeed;
      this.position.z += Math.cos(this.yaw) * -moveY * moveSpeed;
      // Strafe
      this.position.x += Math.sin(this.yaw + Math.PI / 2) * moveX * moveSpeed;
      this.position.z += Math.cos(this.yaw + Math.PI / 2) * moveX * moveSpeed;
    }

    // Looking
    if (this.lookStick.active) {
      const dx = this.lookStick.currentX - this.lookStick.startX;
      const dy = this.lookStick.currentY - this.lookStick.startY;

      const turnX = Math.max(-1, Math.min(1, dx / maxDist));
      const turnY = Math.max(-1, Math.min(1, dy / maxDist));

      this.yaw -= turnX * lookSpeed;
      this.pitch -= turnY * lookSpeed * 0.5;
      this.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch));

      // Smooth reset for continuous feel
      this.lookStick.startX = this.lookStick.startX * 0.9 + this.lookStick.currentX * 0.1;
      this.lookStick.startY = this.lookStick.startY * 0.9 + this.lookStick.currentY * 0.1;
    }

    // Apply to camera
    camera.position.copy(this.position);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch;
  }

  public getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  public getDirection(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    dir.applyEuler(euler);
    return dir.normalize();
  }
}
