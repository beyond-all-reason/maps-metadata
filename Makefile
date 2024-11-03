# Default target ran by make
all: gen/map_list.validated.json gen/mapDetails.lua gen/live_maps.validated.json gen/mapBoxes.conf gen/mapLists.conf gen/custom_map_lists.json gen/discordPresenceThumb gen/mapPresets.conf gen/mapBattlePresets.conf

# Rules for doing generic data files conversion, e.g yaml to json
gen/%.json: %.yaml
	python scripts/py/yaml_to_json.py $< $@

gen/%.validated.json: gen/%.schema.json gen/%.json
	tsx scripts/js/src/validate_schema.ts $^ $@

gen/types/%.d.ts: gen/%.schema.json
	mkdir -p gen/types
	json2ts $< > $@

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

# Tests on data
test: typecheck_scripts check_startboxes check_startpos check_photo_aspect_ratio check_archive_not_solid check_uses_mapinfo_lua
	echo ok

typecheck_scripts: types
	cd scripts/js && tsc --noEmit

check_startboxes: gen/types/map_list.d.ts gen/map_list.validated.json
	tsx scripts/js/src/check_startboxes.ts

check_startpos: gen/types/map_list.d.ts gen/map_list.validated.json
	tsx scripts/js/src/check_startpos.ts

check_photo_aspect_ratio: gen/types/map_list.d.ts gen/map_list.validated.json
	tsx scripts/js/src/check_photo_aspect_ratio.ts

check_archive_not_solid: gen/types/map_list.d.ts gen/map_list.validated.json
	tsx scripts/js/src/check_archive_not_solid.ts

check_uses_mapinfo_lua: gen/types/map_list.d.ts gen/map_list.validated.json
	tsx scripts/js/src/check_uses_mapinfo_lua.ts

# Auxiliary build targets
types: gen/types/map_list.d.ts gen/map_list.schema.json gen/types/cdn_maps.d.ts gen/types/map_modoptions.d.ts gen/types/live_maps.d.ts

clean:
	rm -rf gen/*

update_all_from_rowy: gen/map_list.schema.json
	tsx scripts/js/src/update_from_rowy.ts map_list.yaml all

sync_to_webflow: gen/map_list.validated.json gen/types/map_list.d.ts gen/cdn_maps.validated.json gen/map_list.schema.json gen/types/cdn_maps.d.ts
	tsx scripts/js/src/sync_to_webflow.ts sync

refresh_webflow_types:
	tsx scripts/js/src/gen_webflow_types.ts scripts/js/src/webflow_types.ts

.PHONY: clean test typecheck_scripts check_startboxes types update_all_from_rowy sync_to_webflow refresh_webflow_types
