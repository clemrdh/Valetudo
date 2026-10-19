# Dreame X40 Ultra Complete — Custom Valetudo Fork (`dreame-multifloor`)

Ce dépôt (`clemrdh/Valetudo`, branche `dreame-multifloor`) étend Valetudo `2026.08.0` pour reproduire et surpasser l'expérience Dreamehome sur le **Dreame X40 Ultra Complete (`dreame.vacuum.r2449` / `r2416`)** en local (100 % hors cloud).

---

## 1. Fonctionnalités ajoutées

### 1.1. Gestion Multi-Étage native (Multi-Floor Map Management)
- **Sélecteur de carte sur l'écran d'accueil (`MultiFloorMapControl.tsx`)**, dans le menu de la carte (`LiveMapModeSwitcher.tsx` → mode `map_change` / `MapChangeActions.tsx`) et dans `Options > Map Management`.
- **Opérations supportées (`POST /api/v2/robot/maps` dans `RobotRouter.js` + `util/dreame_map_manager.sh`) :**
  - `load` / `select` : sauvegarde automatiquement la carte courante, restaure l'archive `/data/maps_backup/<id>.tar.gz` (`ri`, `map`, `DivideMap`, `config/ava/mult_map.json`), redémarre proprement `ava` (`touch /tmp/restart_ava.mark && rm -rf /data/ava_reboot_cnt`) et injecte immédiatement l'aperçu de carte depuis `/data/ri/1.dat2` (`last_app_map`) via `loadImmediateMapPreview()`.
  - `save` : sauvegarde la carte active dans un slot existant ou nouveau.
  - `rename` : renomme une carte sauvegardée (`/data/maps_backup/maps_meta.json`).
  - `delete` : supprime une carte sauvegardée.
  - `new` (`nouvelle_carte_vierge`) : initialise une carte vierge pour cartographier un nouvel étage.
  - **Mapping Pass & Map Reset** accessibles directement depuis le panneau Home.
- **Auto-segmentation & Persistance des noms de pièces (`DreameMapParser.js`, `DreameMapSegmentEditCapability.js`, `DreameMapSegmentRenameCapability.js`) :**
  - Si un étage secondaire a été cartographié sans la base et que `ava` n'a pas découpé les pièces, `DreameMapParser.js` segmente automatiquement la carte par composantes connexes (`autoSegmented: true`) et supporte la fusion/division locale (`/data/maps_backup/custom_segments_<floor>.json`).
  - Lors d'un nettoyage sur une carte auto-segmentée, `DreameMapSegmentationCapability.js` convertit automatiquement les pièces sélectionnées en nettoyage par zones englobantes (`mode = 19`, `areas`).
  - Les noms des pièces sont persistés par étage dans `/data/maps_backup/room_names.json` et ré-appliqués à chaque parsing de carte.

### 1.2. Sélecteur de pièces sur la Home & 5 Modes de nettoyage (`RoomCleaningControl.tsx`)
- **Sélection directe des pièces depuis la Home** (chips cliquables + *Tout* / *Aucun*, synchronisés avec les segments cliqués sur la carte).
- **Bouton Start intelligent (`BasicControls.tsx`)** : si des pièces sont sélectionnées, cliquer sur *Start* lance uniquement ces pièces (en mode Global ou en mode Custom par pièce).
- **5 Modes d'opération :**
  1. **Vac+Mop** (`vacuum_and_mop`)
  2. **Vac→Mop** (`vacuum_then_mop`)
  3. **Aspirer** (`vacuum`)
  4. **Laver** (`mop`)
  5. **Custom / pièce** (`useCustomPerRoom: true`) : configuration persistée par pièce et par étage (`/data/maps_backup/room_clean_configs.json` via `GET/PUT /api/v2/robot/room_configs` et `POST /api/v2/robot/room_configs/clean`) permettant de choisir pour chaque pièce son mode (`Vac+Mop`, `Vac→Mop`, `Aspirer`, `Laver`), sa puissance d'aspiration, son débit d'eau et son nombre de passages (`1×`, `2×`, `3×`).

---

## 2. Reverse-Engineering du Firmware (`node_lethe.so` & `liblethe_tactics_tree.so`) et Correctifs

L'analyse par désassemblage AArch64 de `/ava/lib/node_lethe.so` et `/usr/lib/tree_lib/liblethe_tactics_tree.so` (firmware `r2449_1782`) a permis d'identifier et de corriger plusieurs comportements internes :

### 2.1. Push à chaud de la Trajectoire (`CleanRoute`) sur un nettoyage en cours (`DreameCleanRouteControlCapabilityV2.js`)
- **Constat dans le firmware :**
  - Écrire `CleanRoute` dans `MISC_TUNABLES` (SIID `4`, PIID `50`) met à jour `clean_route` dans le Blackboard (`0x891738` dans `node_lethe.so`) et dans `/data/zt_conmon_file/robot_state.json`, mais **ne lève pas le flag `clean_set_change = 1`**.
  - Or `PlanCleansets::tick()` (`0xeea20` / `0xeed1c` dans `liblethe_tactics_tree.so`) ne ré-exécute `HandleCleanPrefer` (`0xe52b0`) pendant un nettoyage actif (`task_state == "cleaning"`) **que si `clean_set_change == 1`**.
  - De plus, pendant un nettoyage de pièces (`task_type == "selectclean"`), la lecture MIOT `4.50` (`0x894690` dans `node_lethe.so`) renvoie `current_cleansets[0].clean_route` au lieu du `CleanRoute` global.
  - Enfin, `HandleCleanPrefer` (`0xe52b0`) n'applique `CleanRoute = 2` (*Intensif* / `slow_mop_mode`) et `CleanRoute = 3` (*Profond* / `slow_mop_mode` + `RobotFineMopSwitch`) que si `operationMode == 1` (*Laver* / Mop).
- **Correctif implémenté :**
  - `setRoute()` écrit `CleanRoute` dans `4.50` puis réécrit `MOP_DOCK_SETTINGS` (`4.23`), ce qui exécute `0x587efc` dans `node_lethe.so` et lève immédiatement **`clean_set_change = 1`** sur le job en cours (en basculant automatiquement `operationMode` sur `1` si la trajectoire choisie est *Intensif* ou *Profond*).
  - `getRoute()` lit directement `/data/zt_conmon_file/robot_state.json` pour éviter le retour erroné à *Standard* lors des nettoyages par pièce.

### 2.2. Nettoyage au ras des plinthes, portes de meubles de cuisine, MopExtend™ et Brosse avant (`DreameQuickSettings.tsx`)
Analyse de `DecideScalableBeforeClean` (`0x348b80`), `Comparetimebeforeclean` (`0x3480b0`), `MeticulousTwistOperate` (`0x349920`) dans `node_lethe.so` et `EdgeMopExtrCtrl` (`0x1781a0`) dans `liblethe_tactics_tree.so` :

1. **Twist sous plinthes / RoboSwing (`DreameMopTwistControlCapabilityV2.js`)** :
   - Valetudo upstream ne modifiait que `LacuneMopScalable` (qui ne gère que les interstices étroits) et laissait `MeticulousTwist` à `-7` (désactivé).
   - C'est **`MeticulousTwist = 1`** (`meticulous_twist` à `0x89140c` / `0x3482d8`) qui fait pivoter l'arrière du robot pour enfoncer la serpillière de ~4 cm sous les portes de meubles de cuisine et plinthes en retrait (`lds_touch_layer` / `edge_trajectory_ob_angle`).
   - De plus, `MeticulousTwist = 7` (*Tous les 7 jours*) est désactivé par `Comparetimebeforeclean` (`0x348380`) dès que `task_type != "AutoClean"` (donc sur tous les nettoyages par pièce !).
   - `DreameMopTwistControlCapabilityV2.enable()` active désormais simultanément `LacuneMopScalable: 1`, **`MeticulousTwist: 1`** et **`ExtrFreq: 2`**.
2. **Fréquence d'extension (`ExtrFreq: 2`) sur `MopExtend™` et `Brosse avant`** :
   - Dans `DecideScalableBeforeClean` (`0x349420`), `ExtrFreq = 1` (*Intelligent*) et `ExtrFreq = 7` (*7 jours*) vérifient `strcmp(task_type, "AutoClean")` et désactivent l'extension sur les nettoyages de pièces (`selectclean`).
   - Seul **`ExtrFreq = 2` (*À chaque nettoyage*, `0x3492d0`)** active inconditionnellement `sbrush_scalable` et `mop_scalable` sur chaque nettoyage de pièce.
   - `DreameMopExtensionControlCapabilityV2.enable()` force donc `MopExtrSwitch: 1`, `MopFullyScalable: 1` et `ExtrFreq: 2`.
   - Le quirk `SIDE_BRUSH_EXTEND` (`DreameQuirkFactory.js`) force `SbrushExtrSwitch: 1` et `ExtrFreq: 2`. (Note matérielle : la brosse avant étant à 45° à l'avant-droit, `EdgeMopExtrCtrl` `0x1781a0` ne la déploie que dans les coins rentrants à 90° `AvaMsgRightAngleMsg` / `IMU_POSE_TurnEnd`, les courbes `close_to_ob_half_in` et les surplombs bas `sneak_clean_under_low`).
3. **Ras des plinthes (`LessColl: 0`)** :
   - Quand `LessColl = 1` (*Mode Anti-Collision* / `multiple_collisions_mode`), `liblethe_route_nodes.so` maintient une marge de ~3 cm (`wall_to_body_dist: 210 mm`) devant les portes de meubles de cuisine surplombant une plinthe en retrait.
   - Le switch **Ras des plinthes** dans `DreameQuickSettings.tsx` pilote `LessColl = 0` pour supprimer cette marge.

---

## 3. Compilation et Déploiement

```powershell
# Compilation complète (Frontend + Backend ARM64)
npm run build --workspace=frontend
npm run build_aarch64 --workspace=backend

# Déploiement SCP sur le robot (192.168.1.48)
$key = "..\dreame_x40_rsa"
scp.exe -O -i $key -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa ".\build\aarch64\valetudo" root@192.168.1.48:/data/valetudo.new
ssh.exe -i $key -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@192.168.1.48 "chmod +x /data/valetudo.new && killall valetudo 2>/dev/null; sleep 1; mv /data/valetudo.new /data/valetudo && VALETUDO_CONFIG_PATH=/data/valetudo_config.json /data/valetudo >/dev/null 2>&1 &"
```
