(function () {
  var sceneEl = document.querySelector('a-scene');
  var movesEl = document.querySelector('#moves');
  var heightEl = document.querySelector('#remaining');
  var messageEl = document.querySelector('#message');
  var nameEl = document.querySelector('#worldName');
  var flashEl = document.querySelector('#flash');
  var GAP = 0.002;

  
  var WORLDS = {
    garden: {
      id: 'garden', name: 'World 1 Garden Tower',
      levels: 18, perLevel: 3, width: 0.2, height: 0.12,     
      background: '#b8d0d6', glow: false,
      colors: ['#B3361E', '#C25540', '#EB7560', '#961D08', '#52221B'],
      pullColor: '#52221B', holdColor: '#f4d6a6',
      arrive: { x: 1.48, z: -0.83 }                            // where you appear when you come through the portal
    },
    neon: {
      id: 'neon', name: 'World 2 Neon Night Tower',
      levels: 14, perLevel: 3, width: 0.2, height: 0.12,     
      background: '#14062b', glow: true,
      colors: ['#00E5FF', '#FF2BD6', '#B6FF00', '#FFB300', '#7C4DFF'],
      pullColor: '#ffffff', holdColor: '#ffffff',
      arrive: { x: -1.48, z: -0.83 }
    },
    ice: {
      id: 'ice', name: 'World 2 · Ice Night Tower',
      levels: 14, perLevel: 3, width: 0.2, height: 0.12,     
      background: '#14062b', glow: true,
      colors: ['#b9e8ea', '#86d6d8', '#3fd0d4', '#20c3d0', '#7C4DFF'],
      pullColor: '#ffffff', holdColor: '#ffffff',
      arrive: { x: -1.48, z: -0.83 }
    }
  };

  // runtime state of the world we are in (swapped when you step through a portal)
  var current = null, worldList = [];
  var cfg, LEVELS, N, BLOCK_WIDTH, BLOCK_HEIGHT, BLOCK_LENGTH, FOOTPRINT, PLACE_ORDER, colors;
  var towerEl, blocks = [], stackedCount = 0, pullCount = 0, ended = false;
  var held = null;        // block currently pinched with the fingers (VR)
  var lastSwitch = 0;

  function applyConfig(c) {
    cfg = c; LEVELS = c.levels; N = c.perLevel; colors = c.colors;
    BLOCK_WIDTH = c.width; BLOCK_HEIGHT = c.height;
    BLOCK_LENGTH = N * c.width;                  // N blocks side by side = one block length
    FOOTPRINT = BLOCK_LENGTH / 2 + 0.2;          // horizontal radius that still counts as "in the tower"
    // fill the middle slots first so the top stays balanced
    PLACE_ORDER = [];
    for (var i = 0; i < N; i++) PLACE_ORDER.push(i);
    PLACE_ORDER.sort(function (a, b) { return Math.abs(a - (N - 1) / 2) - Math.abs(b - (N - 1) / 2) || a - b; });
  }

  function loadWorld(w) {
    current = w; applyConfig(w.cfg);
    towerEl = w.towerEl; blocks = w.blocks; stackedCount = w.stacked; pullCount = w.pulls; ended = w.ended;
    held = null;
  }
  function saveWorld(w) { w.blocks = blocks; w.stacked = stackedCount; w.pulls = pullCount; w.ended = ended; }

  // ---- Tower geometry -------------------------------------------------------
  // Block states: 'tower' (original block), 'top' (stacked by the player),
  // 'out' (pulled out, lying / floating next to the tower)
  function levelY(level) { return level * (BLOCK_HEIGHT + GAP) + BLOCK_HEIGHT / 2; }

  // Slot 0..N-1 on a level. Odd levels are turned by 90 degrees (box sizes are swapped).
  function slotPosition(level, slot) {
    var rotated = level % 2 === 1;
    var off = (slot - (N - 1) / 2) * (BLOCK_WIDTH + GAP);
    return { x: rotated ? 0 : off, y: levelY(level), z: rotated ? off : 0, rotated: rotated };
  }

  function setBlockSize(block, rotated) {
    block.setAttribute('width',  rotated ? BLOCK_LENGTH : BLOCK_WIDTH);
    block.setAttribute('height', BLOCK_HEIGHT);
    block.setAttribute('depth',  rotated ? BLOCK_WIDTH : BLOCK_LENGTH);
  }

  function setColor(block, c) {
    block.setAttribute('color', c);
    if (cfg.glow) block.setAttribute('material', 'emissive', c);
  }

  function buildTowerData() {
    var data = [];
    for (var level = 0; level < LEVELS; level++) {
      for (var i = 0; i < N; i++) {
        var pos = slotPosition(level, i);
        data.push({ level: level, slot: i, isRotated: pos.rotated, position: pos });
      }
    }
    return data;
  }

  // (re)build the tower of the world we are currently in
  function makeTower() {
    towerEl.innerHTML = '';
    blocks = []; stackedCount = 0; pullCount = 0; ended = false; held = null;
    messageEl.style.display = 'none';

    buildTowerData().forEach(function (d) {
      var block = document.createElement('a-box');
      var color = colors[(d.level + d.slot) % colors.length];
      block.setAttribute('position', d.position.x + ' ' + d.position.y + ' ' + d.position.z);
      setBlockSize(block, d.isRotated);
      block.jenga = { state: 'tower', level: d.level, slot: d.slot, rotated: d.isRotated, color: color };
      block.setAttribute('color', color);
      block.setAttribute('material', 'roughness: 0.86; metalness: 0.01' +
        (cfg.glow ? '; emissive: ' + color + '; emissiveIntensity: 0.45' : ''));
      block.setAttribute('class', 'block');
      block.setAttribute('shadow', 'cast: true; receive: true');
      block.addEventListener('click', function (evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        if (ended || held) return;
        if (block.jenga.state === 'out') placeOnTop(block);   // 2nd click: put it on top
        else slideOut(block);                                  // 1st click: pull it out
      });
      towerEl.appendChild(block);
      blocks.push(block);
    });
    current.blocks = blocks;
    updateHud();
  }

  // ---- helpers ---------------------------------------------------------
  function worldPos(el) {
    var p = new THREE.Vector3();
    el.object3D.getWorldPosition(p);
    return p;
  }

  function towerBlocks() {
    return blocks.filter(function (b) { return b.jenga.state === 'tower' || b.jenga.state === 'top'; });
  }

  function towerStats() {
    var counts = {}, maxLevel = -1;
    towerBlocks().forEach(function (b) {
      var l = b.jenga.level;
      counts[l] = (counts[l] || 0) + 1;
      if (l > maxLevel) maxLevel = l;
    });
    return { counts: counts, maxLevel: maxLevel };
  }

  // Next free place on top of the tower
  function nextTopSlot() {
    var st = towerStats();
    if (st.maxLevel < 0) return { level: 0, slot: PLACE_ORDER[0] };
    if ((st.counts[st.maxLevel] || 0) >= N) return { level: st.maxLevel + 1, slot: PLACE_ORDER[0] };
    var used = towerBlocks().filter(function (b) { return b.jenga.level === st.maxLevel; })
                            .map(function (b) { return b.jenga.slot; });
    for (var i = 0; i < PLACE_ORDER.length; i++) {
      if (used.indexOf(PLACE_ORDER[i]) < 0) return { level: st.maxLevel, slot: PLACE_ORDER[i] };
    }
    return { level: st.maxLevel + 1, slot: PLACE_ORDER[0] };
  }

  function emptySlotsBelowTop() {
  var st = towerStats(), holes = 0;
  for (var l = 0; l < st.maxLevel; l++) {
    holes += N - (st.counts[l] || 0);
  }
  return holes;
}

// Check how many blocks remain in a specific row
function blocksRemainingInRow(level) {
  return blocks.filter(function (b) {
    return b.jenga.level === level &&
      (b.jenga.state === 'tower' || b.jenga.state === 'top');
  }).length;
}

  function updateHud() {
    movesEl.textContent = String(stackedCount);
    heightEl.textContent = String(towerStats().maxLevel + 1);
    nameEl.textContent = current ? current.cfg.name : '';
  }

  function towerTopWorldY() {
    return worldPos(towerEl).y + (towerStats().maxLevel + 1) * (BLOCK_HEIGHT + GAP);
  }

  // Keep the a-frame "position" attribute in sync after moving object3D by hand
  function syncPosition(block) {
    var p = block.object3D.position;
    block.setAttribute('position', { x: p.x, y: p.y, z: p.z });
  }

  function moveTo(block, pos, dur, easing) {
    block.removeAttribute('animation__move');
    block.setAttribute('animation__move',
      'property: position; to: ' + pos.x + ' ' + pos.y + ' ' + pos.z + '; dur: ' + (dur || 400) + '; easing: ' + (easing || 'easeOutCubic'));
  }

  // Distance from a point to a (not rotated) block
  function distanceToBlock(b, pos) {
    var c = worldPos(b), j = b.jenga;
    var hx = (j.rotated ? BLOCK_LENGTH : BLOCK_WIDTH) / 2;
    var hy = BLOCK_HEIGHT / 2;
    var hz = (j.rotated ? BLOCK_WIDTH : BLOCK_LENGTH) / 2;
    var dx = Math.max(Math.abs(pos.x - c.x) - hx, 0);
    var dy = Math.max(Math.abs(pos.y - c.y) - hy, 0);
    var dz = Math.max(Math.abs(pos.z - c.z) - hz, 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function nearestBlock(pos) {
    var best = null, bestD = 0.08;
    blocks.forEach(function (b) {
      if (b === held) return;
      var d = distanceToBlock(b, pos);
      if (d < bestD) { bestD = d; best = b; }
    });
    return best;
  }

  // Has the block left the tower? (sideways out of the footprint, or lifted above the top)
  function isClearOfTower(block) {
    var p = worldPos(block), t = worldPos(towerEl);
    if (Math.hypot(p.x - t.x, p.z - t.z) > FOOTPRINT) return true;
    return p.y - BLOCK_HEIGHT / 2 > towerTopWorldY() + 0.05;
  }

  // ---- game actions ----------------------------------------------------
  // A block has just left the tower

 // function blocksRemainingInRow(level) {
  //return blocks.filter(function (b) {
    //return b.jenga.level === level &&
      //(b.jenga.state === 'tower' || b.jenga.state === 'top');
  //}).length;
//}

//var rowIsEmpty = blocksRemainingInRow(j.level) === 0;

//if (rowIsEmpty) {
  //window.setTimeout(function () {
    //if (current === w && !ended) tumbleTower();
  //}, 650);
  //return;
//}

  function markPulled(block) {
  var j = block.jenga;

  if (j.state !== 'tower' && j.state !== 'top') return;

  var level = j.level;

  j.state = 'out';
  pullCount++;
  updateHud();

  // Check if the entire row is empty
  var remainingInRow = blocksRemainingInRow(level);

  var w = current;

  if (remainingInRow === 0) {
    window.setTimeout(function () {
      if (current === w && !ended) {
        tumbleTower();
      }
    }, 650);

    return;
  }

  // Original random collapse mechanic
  var risk = Math.min(
    0.05 + 0.020 * emptySlotsBelowTop(),
    0.45
  );

  if (pullCount >= 3 && Math.random() < risk) {
    window.setTimeout(function () {
      if (current === w && !ended) {
        tumbleTower();
      }
    }, 650);
  }
}


  // Mouse: slide the block out along its long side
  function slideOut(block) {
    var j = block.jenga;
    var p = block.object3D.position;
    var dist = BLOCK_LENGTH * 1.7;
    markPulled(block);
    setColor(block, cfg.pullColor);
    moveTo(block, { x: p.x + (j.rotated ? dist : 0), y: p.y + 0.03, z: p.z + (j.rotated ? 0 : dist) }, 360);
  }

  // Put a pulled-out block on top of the tower
  function placeOnTop(block) {
    if (ended) return;
    var j = block.jenga;
    var slot = nextTopSlot();
    var pos = slotPosition(slot.level, slot.slot);
    j.state = 'top'; j.level = slot.level; j.slot = slot.slot; j.rotated = pos.rotated;
    setBlockSize(block, pos.rotated);       // turn it to match the level
    block.setAttribute('rotation', '0 0 0');
    setColor(block, j.color);
    syncPosition(block);
    moveTo(block, pos, 520, 'easeInOutQuad');
    stackedCount++;
    updateHud();
  }

  // Let go of a pulled-out block somewhere that is not the top: it lands on the podium or floor
  function dropToSurface(block) {
    var p = worldPos(block), t = worldPos(towerEl);
    var dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz);
    if (d < FOOTPRINT + 0.05) {                       // not inside the tower itself
      if (d < 1e-3) { dx = 0; dz = 1; d = 1; }
      var k = 1.0 / d; dx *= k; dz *= k; d = 1.0;
    }
    var onPodium = d <= 0.72;
    var worldY = onPodium ? t.y + BLOCK_HEIGHT / 2 : BLOCK_HEIGHT / 2;
    block.setAttribute('rotation', '0 0 0');
    setColor(block, cfg.holdColor);
    syncPosition(block);
    // dx / dz are already relative to the tower, which is also the block's parent
    moveTo(block, { x: dx, y: worldY - t.y, z: dz }, 350, 'easeInQuad');
  }

  // ---- Gravity ---------------------------------------------------------------
  // Same idea as the classic component() example: on every update the falling
  // speed grows by `gravity`, and the block moves by its sideways speed and by
  // gravitySpeed:      gravitySpeed += gravity;   y -= gravitySpeed
  // (in the 2D canvas y points down so it was "+="; in A-Frame y points up.)
  // Gravity is in m/s^2 and every update is scaled by the frame time dt, so the
  // fall looks the same at 60 or 90 fps.
  var GRAVITY = 9.8;
  var BOUNCE = 0.25;            // how much of the speed a block keeps when it hits the ground
  var PODIUM_RADIUS = 0.76;

  function Faller(block, delay, speedX, speedZ, kick) {
    this.block = block;
    this.delay = delay;                 // seconds before this block lets go
    this.gravity = GRAVITY;
    this.gravitySpeed = -kick;          // downward speed (a small negative value = tiny upward jolt)
    this.speedX = speedX;
    this.speedZ = speedZ;
    this.spinX = (Math.random() - 0.5) * 6;   // rad/s
    this.spinY = (Math.random() - 0.5) * 4;
    this.spinZ = (Math.random() - 0.5) * 6;
    this.landed = false;
    this.halfH = BLOCK_HEIGHT / 2;
    this.podiumRest = BLOCK_HEIGHT / 2;                       // block centre when lying on the podium
    this.floorRest = -worldPos(towerEl).y + BLOCK_HEIGHT / 2; // ... or on the floor (tower-local coords)
  }

  // returns false when the block has come to rest
  Faller.prototype.newPos = function (dt) {
    if (this.delay > 0) { this.delay -= dt; return true; }
    var o = this.block.object3D, p = o.position, r = o.rotation;
    var prevY = p.y;

    this.gravitySpeed += this.gravity * dt;     // gravitySpeed += gravity
    p.x += this.speedX * dt;                    // x += speedX
    p.z += this.speedZ * dt;
    p.y -= this.gravitySpeed * dt;              // y += speedY + gravitySpeed

    if (!this.landed) {                         // tumbling in the air
      r.x += this.spinX * dt; r.y += this.spinY * dt; r.z += this.spinZ * dt;
    }

    // the ground: the podium (if we are above it) or the floor
    var d = Math.hypot(p.x, p.z);
    var ground = this.floorRest;
    if (d < PODIUM_RADIUS && prevY >= this.podiumRest - 1e-4) ground = this.podiumRest;

    if (p.y <= ground) {
      p.y = ground;
      this.landed = true;
      if (this.gravitySpeed > 0.6) {            // hits hard: bounce a little, lose speed
        this.gravitySpeed = -this.gravitySpeed * BOUNCE;
        this.speedX *= 0.6; this.speedZ *= 0.6;
      } else {
        this.gravitySpeed = 0;
      }
    }

    if (this.landed) {
      var damp = Math.max(0, 1 - 6 * dt);       // friction with the ground
      this.speedX *= damp; this.speedZ *= damp;
      var flat = Math.min(1, 10 * dt);          // ease the block flat
      r.x -= r.x * flat; r.z -= r.z * flat;
      var still = Math.abs(this.speedX) + Math.abs(this.speedZ) < 0.03 &&
                  this.gravitySpeed === 0 && Math.abs(r.x) + Math.abs(r.z) < 0.02;
      if (still) {
        r.x = 0; r.z = 0;
        return false;
      }
    }
    return true;
  };

  function updateFalling(dt) {
    if (dt > 0.05) dt = 0.05;                   // e.g. after switching browser tabs
    worldList.forEach(function (w) {
      w.blocks.forEach(function (b) {
        if (!b.faller) return;
        if (!b.faller.newPos(dt)) {             // at rest: hand the final pose back to A-Frame
          var p = b.object3D.position, r = b.object3D.rotation, deg = 180 / Math.PI;
          b.setAttribute('position', { x: p.x, y: p.y, z: p.z });
          b.setAttribute('rotation', { x: r.x * deg, y: r.y * deg, z: r.z * deg });
          b.faller = null;
        }
      });
    });
  }

  function tumbleTower() {
    if (ended) return;
    ended = true;
    var lean = Math.random() * Math.PI * 2;     // the tower leans one way as it goes over
    blocks.forEach(function (b) {
     // if (b.jenga.state === 'out') return;      // blocks you already pulled out stay where they are
      b.removeAttribute('animation__move');
      b.removeAttribute('animation__fall');
      var p = b.object3D.position;
      var height = b.jenga.level / LEVELS;      // 0 = bottom, 1 = top: higher blocks fly further
      var d = Math.hypot(p.x, p.z) || 1;
      var out = 0.2 + Math.random() * 0.6;      // push away from the middle
      var side = 0.3 + 0.9 * height;            // push in the lean direction
      var speedX = (p.x / d) * out + Math.cos(lean) * side + (Math.random() - 0.5) * 0.3;
      var speedZ = (p.z / d) * out + Math.sin(lean) * side + (Math.random() - 0.5) * 0.3;
      var delay = (1 - height) * 0.25 + Math.random() * 0.08;   // the top lets go first
      b.faller = new Faller(b, delay, speedX, speedZ, Math.random() * 0.6);
    });
    showEnd('Tower tumbled!', 'You stacked ' + stackedCount + ' block' + (stackedCount === 1 ? '' : 's') + ' on top. Try again, or step through the portal to the other world.');
  }

  function showEnd(title, text) {
    ended = true;
    document.querySelector('#messageTitle').textContent = title;
    var textEl = document.querySelector('#messageText');   // optional: it is commented out in index.html
    if (textEl) textEl.textContent = text;
    messageEl.style.display = 'block';
  }

  // ---- Portals: switch between the worlds ---------------------------------
  // Show only the active world, and only let its blocks / portal be clicked
  function applyActiveWorld() {
    worldList.forEach(function (w) {
      var active = w === current;
      w.root.setAttribute('visible', active);
      w.blocks.forEach(function (b) { if (active) b.classList.add('block'); else b.classList.remove('block'); });
      w.root.querySelectorAll('[data-portal-part]').forEach(function (el) {
        if (active) el.classList.add('portal-element'); else el.classList.remove('portal-element');
      });
    });
    var mouse = document.querySelector('#mouse');
    if (mouse && mouse.components && mouse.components.raycaster) mouse.components.raycaster.refreshObjects();
  }

  // Put the player in front of the arrival portal, looking at the tower
  function placePlayer(spawn) {
    var rig = document.querySelector('#rig').object3D;
    var camera = sceneEl.camera;
    if (!camera) return;
    var t = worldPos(towerEl);
    var wantedYaw = Math.atan2(-(t.x - spawn.x), -(t.z - spawn.z));   // yaw that makes -z point at the tower

    if (sceneEl.is('vr-mode')) {
      var dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      rig.rotation.y += wantedYaw - Math.atan2(-dir.x, -dir.z);
    } else {
      var lc = document.querySelector('#cam').components['look-controls'];
      if (lc && lc.yawObject) { lc.yawObject.rotation.y = wantedYaw; if (lc.pitchObject) lc.pitchObject.rotation.x = 0; }
    }
    rig.updateWorldMatrix(true, true);
    var c = new THREE.Vector3();
    camera.getWorldPosition(c);
    rig.position.x += spawn.x - c.x;
    rig.position.z += spawn.z - c.z;
  }

  function enterWorld(id) {
    var target = WORLDS[id] && WORLDS[id].record;
    if (!target || target === current) return;
    if (Date.now() - lastSwitch < 1500) return;      // avoid ping-pong when you arrive next to a portal
    lastSwitch = Date.now();

    if (held) releaseHeld();                         // whatever is in your hand stays in the old world
    saveWorld(current);
    loadWorld(target);
    sceneEl.setAttribute('background', 'color', target.cfg.background);
    messageEl.style.display = ended ? 'block' : 'none';
    applyActiveWorld();
    updateHud();
    placePlayer(target.cfg.arrive);

    flashEl.style.transition = 'none'; flashEl.style.opacity = '1';
    void flashEl.offsetWidth;
    flashEl.style.transition = 'opacity .7s ease-out'; flashEl.style.opacity = '0';
  }

  AFRAME.registerComponent('portal', {
    schema: {
      world: { type: 'string' },     // the world this portal stands in
      target: { type: 'string' },    // the world it leads to
      label: { type: 'string', default: 'Portal' },
      color: { default: '#00E5FF' },
      glow: { default: '#FF2BD6' }
    },
    init: function () {
      var self = this, el = this.el, d = this.data;

      function part(tag, attrs) {
        var e = document.createElement(tag);
        Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
        e.setAttribute('data-portal-part', '');
        e.classList.add('portal-element');
        e.addEventListener('click', function (evt) {
          if (evt && evt.stopPropagation) evt.stopPropagation();
          enterWorld(d.target);
        });
        el.appendChild(e);
        return e;
      }
      // glowing ring + shimmering disc that stands for the other world
      part('a-torus', { radius: 0.75, 'radius-tubular': 0.045, color: d.color, material: 'shader: flat' });
      part('a-circle', {
        radius: 0.72, color: d.glow, material: 'shader: flat; side: double; opacity: 0.7',
        animation: 'property: material.opacity; from: 0.45; to: 0.85; dir: alternate; loop: true; dur: 1400; easing: easeInOutSine'
      });
      part('a-circle', {
        radius: 0.4, position: '0 0 0.01', color: '#ffffff', material: 'shader: flat; side: double; opacity: 0.35',
        animation: 'property: scale; from: 0.6 0.6 0.6; to: 1.15 1.15 1.15; dir: alternate; loop: true; dur: 1800; easing: easeInOutSine'
      });
      // little lights orbiting the ring
      var orbit = document.createElement('a-entity');
      orbit.setAttribute('animation', 'property: rotation; to: 0 0 360; loop: true; dur: 5000; easing: linear');
      for (var i = 0; i < 8; i++) {
        var a = i / 8 * Math.PI * 2;
        var s = document.createElement('a-sphere');
        s.setAttribute('radius', 0.05);
        s.setAttribute('position', (Math.cos(a) * 0.9) + ' ' + (Math.sin(a) * 0.9) + ' 0');
        s.setAttribute('material', 'shader: flat; color: ' + d.color);
        orbit.appendChild(s);
      }
      el.appendChild(orbit);
      var text = document.createElement('a-text');
      text.setAttribute('value', d.label);
      text.setAttribute('align', 'center');
      text.setAttribute('position', '0 1.15 0');
      text.setAttribute('width', 3);
      text.setAttribute('side', 'double');
      text.setAttribute('color', '#ffffff');
      el.appendChild(text);

      this.cam = new THREE.Vector3();
      this.me = new THREE.Vector3();
    },
    tick: function () {
      // walk into the portal to go through
      if (!current || current.id !== this.data.world || !sceneEl.camera) return;
      sceneEl.camera.getWorldPosition(this.cam);
      this.el.object3D.getWorldPosition(this.me);
      if (this.cam.distanceTo(this.me) < 0.8) enterWorld(this.data.target);
    }
  });

  // ---- VR: pinch to hold a block, pull it out, let go above the tower ----
  // Hand positions are reported in the rig's space; convert them to world space
  // so grabbing keeps working after the player has moved.
  function handToWorld(hand, p) {
    var parent = hand.object3D.parent;
    parent.updateWorldMatrix(true, false);
    return parent.localToWorld(new THREE.Vector3(p.x, p.y, p.z));
  }

  function releaseHeld() {
    if (!held) return;
    var block = held;
    held = null;
    if (ended) return;
    var j = block.jenga;
    syncPosition(block);
    if (j.state === 'tower' || j.state === 'top') {
      // never left the tower: slide back into its slot
      setColor(block, j.color);
      moveTo(block, slotPosition(j.level, j.slot), 250);
      return;
    }
    // pulled out: if it is released above the tower, stack it there
    var pw = worldPos(block), tw = worldPos(towerEl);
    var overTower = Math.hypot(pw.x - tw.x, pw.z - tw.z) < FOOTPRINT && pw.y > towerTopWorldY() - 0.15;
    if (overTower) placeOnTop(block);
    else dropToSurface(block);
  }

  AFRAME.registerComponent('pinch-grab', {
    init: function () {
      var hand = this.el;
      hand.addEventListener('pinchstarted', function (evt) {
        if (ended || held) return;
        var detail = evt.detail || {};
        var p = detail.position || detail;
        if (typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') return;
        var pos = handToWorld(hand, p);
        var candidate = nearestBlock(pos);
        if (candidate) {
          held = candidate;
          held.removeAttribute('animation__move');
          syncPosition(held);
          setColor(held, cfg.holdColor);
          held.object3D.userData.grabOffset = worldPos(held).sub(pos);
        }
      });
      hand.addEventListener('pinchmoved', function (evt) {
        if (!held || ended) return;
        var detail = evt.detail || {};
        var p = detail.position || detail;
        if (typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number') return;
        var offset = held.object3D.userData.grabOffset || new THREE.Vector3();
        var world = handToWorld(hand, p).add(offset);
        held.object3D.position.copy(towerEl.object3D.worldToLocal(world));
        // the moment it is clear of the tower, it counts as pulled out - and you keep holding it
        if ((held.jenga.state === 'tower' || held.jenga.state === 'top') && isClearOfTower(held)) markPulled(held);
      });
      hand.addEventListener('pinchended', releaseHeld);
    }
  });

  // Left thumbstick walking in VR (the headset itself already handles real walking)
  AFRAME.registerComponent('thumbstick-move', {
    init: function () {
      var self = this;
      this.axis = { x: 0, y: 0 };
      this.dir = new THREE.Vector3();
      this.el.addEventListener('thumbstickmoved', function (e) {
        self.axis.x = e.detail.x; self.axis.y = e.detail.y;
      });
    },
    tick: function (t, dt) {
      var a = this.axis;
      if (Math.abs(a.x) < 0.15 && Math.abs(a.y) < 0.15) return;
      var camera = this.el.sceneEl.camera;
      if (!camera) return;
      camera.getWorldDirection(this.dir);
      this.dir.y = 0;
      if (this.dir.lengthSq() < 1e-6) return;
      this.dir.normalize();
      var rig = document.querySelector('#rig').object3D;
      var speed = 1.6 * dt / 1000;
      // forward = -y on the stick, right = +x
      rig.position.x += (this.dir.x * -a.y + (-this.dir.z) * a.x) * speed;
      rig.position.z += (this.dir.z * -a.y + this.dir.x * a.x) * speed;
    }
  });

  // On the desktop, keep the player outside the podium / tower and on the floor area
  AFRAME.registerComponent('keep-out', {
    schema: { radius: { default: 1.0 }, limit: { default: 13 } },
    init: function () {
      this.cam = new THREE.Vector3();
      this.center = new THREE.Vector3();
    },
    tick: function () {
      if (this.el.is('vr-mode') || !this.el.camera) return;
      var rig = document.querySelector('#rig').object3D;
      this.el.camera.getWorldPosition(this.cam);
      towerEl.object3D.getWorldPosition(this.center);
      var dx = this.cam.x - this.center.x, dz = this.cam.z - this.center.z;
      var d = Math.hypot(dx, dz), r = this.data.radius;
      if (d < r) {
        if (d < 1e-4) { dx = 0; dz = 1; d = 1; }
        rig.position.x += dx / d * (r - d);
        rig.position.z += dz / d * (r - d);
      }
      rig.position.x = Math.max(-this.data.limit, Math.min(this.data.limit, rig.position.x));
      rig.position.z = Math.max(-this.data.limit, Math.min(this.data.limit, rig.position.z));
    }
  });

  // ---- start ----
  function decorateNeonWorld(root) {
    for (var i = 0; i < 110; i++) {                               // stars
      var s = document.createElement('a-sphere');
      var az = Math.random() * Math.PI * 2, el = Math.random() * 1.2 + 0.08, r = 28 + Math.random() * 10;
      s.setAttribute('radius', 0.06 + Math.random() * 0.1);
      s.setAttribute('position', (Math.cos(az) * Math.cos(el) * r) + ' ' + (Math.sin(el) * r) + ' ' + (Math.sin(az) * Math.cos(el) * r));
      s.setAttribute('material', 'shader: flat; color: ' + (Math.random() < 0.3 ? '#9fe8ff' : '#ffffff'));
      root.appendChild(s);
    }
    var cols = ['#00E5FF', '#FF2BD6', '#B6FF00', '#FFB300', '#7C4DFF'];
    for (var k = 0; k < 6; k++) {                                 // floating crystals
      var c = document.createElement('a-octahedron');
      var a = k / 6 * Math.PI * 2 + 0.4;
      c.setAttribute('radius', 0.25);
      c.setAttribute('position', (Math.cos(a) * 5) + ' ' + (1.5 + (k % 3) * 0.8) + ' ' + (-3 + Math.sin(a) * 5));
      c.setAttribute('material', 'shader: flat; color: ' + cols[k % cols.length] + '; opacity: 0.85');
      c.setAttribute('animation', 'property: rotation; to: 0 360 0; loop: true; dur: ' + (6000 + k * 700) + '; easing: linear');
      root.appendChild(c);
    }
  }

  AFRAME.registerComponent('tower-game', {
    tick: function (time, delta) { updateFalling(delta / 1000); },
    init: function () {
      // build both towers, then start in the Garden
      Object.keys(WORLDS).forEach(function (id) {
        var cfgW = WORLDS[id];
        var w = { id: id, cfg: cfgW, root: document.querySelector('#world-' + id),
                  towerEl: document.querySelector('#tower-' + id),
                  blocks: [], stacked: 0, pulls: 0, ended: false };
        cfgW.record = w;
        worldList.push(w);
        loadWorld(w);
        makeTower();
        saveWorld(w);
      });
      decorateNeonWorld(WORLDS.neon.record.root);
      loadWorld(WORLDS.garden.record);
      applyActiveWorld();
      updateHud();
    }
  });
  document.querySelector('#reset').addEventListener('click', function () { makeTower(); applyActiveWorld(); });
  document.querySelector('#playAgain').addEventListener('click', function () { makeTower(); applyActiveWorld(); });
})();
