# Comprobación en Godot 4 del .glb exportado con --colisiones godot (tests/motores/comprobar.mjs).
# Carga res://casa.glb, cuenta los cuerpos y formas de colisión que crea el importador a partir de los
# sufijos -colonly y -convcolonly, lanza rayos hacia abajo para ver contra qué choca un personaje y hace
# andar personajes (CharacterBody3D con gravedad) por un camino de puntos, p. ej. escalera arriba.
# Escribe una línea «RESULTADO {json}» y sale. Pensado para «--fixed-fps 60» (física sin esperar al reloj).
extends SceneTree

func _contar(n: Node, r: Dictionary) -> void:
	if n is StaticBody3D:
		r.cuerpos += 1
		r.nombres.append(String(n.name))
	if n is CollisionShape3D and n.shape != null:
		if n.shape is ConcavePolygonShape3D:
			r.concavas += 1
		elif n.shape is ConvexPolygonShape3D:
			r.convexas += 1
		else:
			r.otras += 1
	if n is MeshInstance3D:
		r.mallas += 1
	for h in n.get_children():
		_contar(h, r)

# Un personaje cápsula de «alto» m anda de punto en punto ([X, Z] en m) a 1,4 m/s, con gravedad.
# Se para al llegar al último punto, si no avanza en 2 s o a los 30 s.
func _andar(camino: Array, alto: float) -> Dictionary:
	var cuerpo := CharacterBody3D.new()
	var forma := CollisionShape3D.new()
	var capsula := CapsuleShape3D.new()
	capsula.radius = 0.25
	capsula.height = alto
	forma.shape = capsula
	forma.position = Vector3(0, alto / 2.0, 0)
	cuerpo.add_child(forma)
	root.add_child(cuerpo)
	cuerpo.global_position = Vector3(camino[0][0], 0.05, camino[0][1])
	var paso := 1.0 / Engine.physics_ticks_per_second
	var objetivo := 1
	var alturas: Array = []
	var mejor := INF
	var sin_avanzar := 0.0
	var t := 0.0
	while t < 30.0 and objetivo < camino.size() and sin_avanzar < 2.0:
		await physics_frame
		t += paso
		var p := cuerpo.global_position
		var d := Vector3(camino[objetivo][0] - p.x, 0.0, camino[objetivo][1] - p.z)
		if d.length() < 0.1:
			alturas.append(snappedf(p.y, 0.001))
			objetivo += 1
			mejor = INF
			sin_avanzar = 0.0
			continue
		if d.length() < mejor - 0.005:
			mejor = d.length()
			sin_avanzar = 0.0
		else:
			sin_avanzar += paso
		var h := d.normalized() * 1.4
		var vy := 0.0 if cuerpo.is_on_floor() else cuerpo.velocity.y - 9.8 * paso
		cuerpo.velocity = Vector3(h.x, vy, h.z)
		cuerpo.move_and_slide()
	# Medio segundo quieto para asentarse en el suelo.
	for i in 30:
		await physics_frame
		cuerpo.velocity = Vector3(0.0, 0.0 if cuerpo.is_on_floor() else cuerpo.velocity.y - 9.8 * paso, 0.0)
		cuerpo.move_and_slide()
	var f := cuerpo.global_position
	var res := {"alto": alto, "llega": objetivo >= camino.size(), "puntos": objetivo - 1, "alturas": alturas,
		"final": [snappedf(f.x, 0.001), snappedf(f.y, 0.001), snappedf(f.z, 0.001)], "en_suelo": cuerpo.is_on_floor(), "segundos": snappedf(t, 0.01)}
	cuerpo.queue_free()
	await physics_frame
	return res

func _init() -> void:
	var escena: PackedScene = load("res://casa.glb")
	if escena == null:
		print("RESULTADO {\"error\": \"no se pudo cargar casa.glb\"}")
		quit(1)
		return
	var raiz := escena.instantiate()
	root.add_child(raiz)
	var r := {"cuerpos": 0, "concavas": 0, "convexas": 0, "otras": 0, "mallas": 0, "nombres": [], "rayos": {}}
	_contar(raiz, r)
	# La física necesita un par de fotogramas para registrar los cuerpos.
	await physics_frame
	await physics_frame
	var espacio: PhysicsDirectSpaceState3D = raiz.get_world_3d().direct_space_state
	var puntos: Array = []
	var andar: Dictionary = {}
	var arg := OS.get_cmdline_user_args()
	for a in arg:
		if a.begins_with("--rayos="):
			puntos = JSON.parse_string(a.substr(8))
		elif a.begins_with("--andar="):
			andar = JSON.parse_string(a.substr(8))
	for p in puntos:
		var q := PhysicsRayQueryParameters3D.create(Vector3(p[1], 20.0, p[2]), Vector3(p[1], -1.0, p[2]))
		var hit: Dictionary = espacio.intersect_ray(q)
		r.rayos[p[0]] = hit.position.y if hit else null
	r.personajes = []
	if andar:
		for alto in andar.altos:
			r.personajes.append(await _andar(andar.camino, float(alto)))
	print("RESULTADO " + JSON.stringify(r))
	quit(0)
