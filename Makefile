# Default target ran by make
all: gen/map_list.validated.json gen/mapDetails.lua gen/live_maps.validated.json gen/mapBoxes.conf gen/mapLists.conf gen/custom_map_lists.json gen/discordPresenceThumb gen/mapPresets.conf gen/mapBattlePresets.conf gen/lobby_maps.validated.json gen/teiserver_maps.validated.json

# Rules for doing generic data files conversion, e.g yaml to json
gen/%.json: %.yaml
	python scripts/py/yaml_to_json.py $< $@

gen/%.validated.json: gen/schemas/%.json gen/%.json
	tsx scripts/js/src/validate_schema.ts $^ $@

gen/types/%.d.ts: gen/schemas/%.json
	mkdir -p gen/types
	json2ts --cwd gen/schemas $< $@

# Additional explicit dependencies
gen/schemas/teiserver_maps.json: gen/schemas/map_modoptions.json gen/schemas/map_list.json
gen/schemas/lobby_maps.json: gen/schemas/map_list.json

# Output targets
gen/mapDetails.lua: gen/map_list.validated.json gen/types/map_list.d.ts 
	tsx scripts/js/src/gen_map_details_lua.ts $@

gen/cdn_maps.json: gen/map_list.validated.json gen/types/map_list.d.ts
	tsx scripts/js/src/gen_cdn_maps.ts $@

gen/live_maps.json: gen/map_list.validated.json gen/types/map_list.d.ts gen/cdn_maps.validated.json gen/types/cdn_maps.d.ts gen/types/live_maps.d.ts
	tsx scripts/js/src/gen_live_maps.ts $@

gen/mapBoxes.conf: gen/map_list.validated.json gen/types/map_list.d.ts
	tsx scripts/js/src/gen_map_boxes_conf.ts $@

gen/mapLists.conf gen/custom_map_lists.json &: gen/map_list.validated.json
	python scripts/py/gen_nextmap_maplists.py

gen/discordPresenceThumb: gen/map_list.validated.json gen/types/map_list.d.ts
	tsx scripts/js/src/gen_discord_presence_thumbs.ts $@

gen/map_modoptions.json: gen/map_list.validated.json gen/types/map_list.d.ts gen/types/map_modoptions.d.ts
	tsx scripts/js/src/gen_map_modoptions.ts $@

gen/mapPresets.conf gen/mapBattlePresets.conf &: gen/map_modoptions.validated.json gen/types/map_modoptions.d.ts
	tsx scripts/js/src/gen_spads_map_presets.ts gen/mapPresets.conf gen/mapBattlePresets.conf

gen/lobby_maps.json: gen/map_list.validated.json gen/cdn_maps.validated.json gen/types/map_list.d.ts gen/types/lobby_maps.d.ts
	tsx scripts/js/src/gen_lobby_maps.ts $@

gen/teiserver_maps.json: gen/map_list.validated.json gen/types/map_list.d.ts gen/map_modoptions.validated.json gen/types/map_modoptions.d.ts gen/types/teiserver_maps.d.ts
	tsx scripts/js/src/gen_teiserver_maps.ts $@

# Tests on data
checks = $(notdir $(basename $(wildcard scripts/js/src/check_*.ts)))
test: typecheck_scripts $(checks)
	echo ok

typecheck_scripts: types
	cd scripts/js && tsc --noEmit

check_%: scripts/js/src/check_%.ts gen/types/map_list.d.ts gen/map_list.validated.json
	tsx $<

# Auxiliary build targets
types: gen/types/map_list.d.ts gen/schemas/map_list.json gen/types/cdn_maps.d.ts gen/types/map_modoptions.d.ts gen/types/live_maps.d.ts gen/types/lobby_maps.d.ts

clean:
	rm -rf gen/*

update_all_from_rowy: gen/schemas/map_list.json
	tsx scripts/js/src/update_from_rowy.ts map_list.yaml all

sync_to_webflow: gen/map_list.validated.json gen/types/map_list.d.ts gen/cdn_maps.validated.json gen/schemas/map_list.json gen/types/cdn_maps.d.ts
	tsx scripts/js/src/sync_to_webflow.ts sync

refresh_webflow_types:
	tsx scripts/js/src/gen_webflow_types.ts scripts/js/src/webflow_types.ts

.PHONY: clean test typecheck_scripts types update_all_from_rowy sync_to_webflow refresh_webflow_types
