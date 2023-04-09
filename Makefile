# Default target ran by make
all: gen/map_list.validated.json gen/mapDetails.lua

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

# Tests on data
test: check_listed_maps_exist
	echo ok

check_listed_maps_exist: gen/map_list.validated.json gen/types/map_list.d.ts
	ts-node scripts/js/src/check_maps_exist.ts $<

# Auxiliary build targets
types: gen/types/map_list.d.ts gen/map_list.schema.json

clean:
	rm -rf gen/*

update_all_from_rowy: gen/map_list.schema.json
	ts-node scripts/js/src/update_from_rowy.ts map_list.yaml all

.PHONY: clean test check_listed_maps_exist types update_all_from_rowy
