if (typeof THREE === "undefined") {
    throw new Error(
      "Three.js не загружен. Подключите three.min.js перед этим скриптом."
    );
  }
  
  const scene = new THREE.Scene();
  scene.background = null;
  
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 5, 20);
  
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  document.getElementById("three-bg").appendChild(renderer.domElement);
  
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  const pointLight = new THREE.PointLight(0xff88cc, 1.0);
  pointLight.position.set(10, 15, 10);
  scene.add(pointLight);
  
  const clock = new THREE.Clock();
  
  function createRibbon() {
    class TwistingCurve extends THREE.Curve {
      constructor(scale = 2) {
        super();
        this.scale = scale;
      }
      getPoint(t, optionalTarget = new THREE.Vector3()) {
        const baseX = 15;
        const startY = -10;
        const endY = 50;
        const frequency = 5;
        const amplitudeX = 3;
        const amplitudeZ = 3;
        const x = baseX + amplitudeX * Math.sin(2 * Math.PI * frequency * t);
        const y = startY + (endY - startY) * t;
        const z = amplitudeZ * Math.cos(2 * Math.PI * frequency * t);
        return optionalTarget.set(x, y, z).multiplyScalar(this.scale);
      }
    }
  
    const path = new TwistingCurve(1);
    const tubeGeometry = new THREE.TubeGeometry(path, 300, 1, 32, false);
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(
      "https://threejs.org/examples/textures/uv_grid_opengl.jpg"
    );
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 10);
  
    const material = new THREE.MeshPhysicalMaterial({
      map: texture,
      color: 0x8b007d,
      metalness: 0.4,
      roughness: 0.2,
      emissive: 0x220022,
      side: THREE.DoubleSide,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
      transparent: true,
    });
  
    const ribbon = new THREE.Mesh(tubeGeometry, material);
    scene.add(ribbon);
  
    function animateRibbon() {
      const elapsedTime = clock.getElapsedTime();
      ribbon.position.x = 0.2 + Math.sin(elapsedTime * 0.3) * 1.5;
      ribbon.rotation.x = Math.sin(elapsedTime * 1) * 0.1;
      requestAnimationFrame(animateRibbon);
    }
    animateRibbon();
  }
  
  function createParticleField() {
    const particleCount = 500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const color = new THREE.Color(0xaa77ff);
  
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
  
      velocities[i * 3] = (Math.random() - 0.5) * 0.02;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
  
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
  
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(
      "https://threejs.org/examples/textures/sprites/spark1.png"
    );
  
    const material = new THREE.PointsMaterial({
      size: 0.3,
      map: texture,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  
    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
  
    function animateParticles() {
      const positions = geometry.attributes.position.array;
      for (let i = 0; i < particleCount; i++) {
        positions[i * 3] += velocities[i * 3];
        positions[i * 3 + 1] += velocities[i * 3 + 1];
        positions[i * 3 + 2] += velocities[i * 3 + 2];
  
        if (Math.abs(positions[i * 3]) > 15) velocities[i * 3] *= -1;
        if (Math.abs(positions[i * 3 + 1]) > 15) velocities[i * 3 + 1] *= -1;
        if (Math.abs(positions[i * 3 + 2]) > 15) velocities[i * 3 + 2] *= -1;
      }
      geometry.attributes.position.needsUpdate = true;
      requestAnimationFrame(animateParticles);
    }
    animateParticles();
  }
  
  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
  
  window.createRibbon = createRibbon;
  window.createParticleField = createParticleField;
  