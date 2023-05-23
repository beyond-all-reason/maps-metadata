# Default target ran by make
all: gen/map_list.validated.json gen/mapDetails.lua gen/live_maps.validated.json

# Rules for doing generic data files conversion, e.g yaml to json
gen/%.json: %.yaml
	python scripts/py/yaml_to_json.py $< $@

gen/%.validated.json: gen/%.schema.json gen/%.json
	ts-node scripts/js/src/validate_schema.ts $^ $@

gen/types/%.d.ts: gen/%.schema.json
	mkdir -p gen/types
	json2ts $< > $@

# Output targets
gen/mapDetails.lua: gen/map_list.validated.json gen/types/map_list.d.ts 
	ts-node scripts/js/src/gen_map_details_lua.ts $@

gen/cdn_maps.json: gen/map_list.validated.json gen/types/map_list.d.ts
	ts-node scripts/js/src/gen_cdn_maps.ts $@

gen/live_maps.json: gen/map_list.validated.json gen/types/map_list.d.ts gen/cdn_maps.validated.json gen/types/cdn_maps.d.ts gen/types/live_maps.d.ts
	ts-node scripts/js/src/gen_live_maps.ts $@

# Tests on data
test: typecheck_scripts
	echo ok

typecheck_scripts: gen/types/map_list.d.ts gen/types/live_maps.d.ts gen/types/cdn_maps.d.ts
	cd scripts/js && tsc --noEmit

# Auxiliary build targets
types: gen/types/map_list.d.ts gen/map_list.schema.json

clean:
	rm -rf gen/*

update_all_from_rowy: gen/map_list.schema.json
	ts-node scripts/js/src/update_from_rowy.ts map_list.yaml all

.PHONY: clean test typecheck_scripts types update_all_from_rowy
