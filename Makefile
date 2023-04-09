gen/%.json: %.yaml
	python scripts/py/yaml_to_json.py $< $@

gen/%.validated.json: gen/%.schema.json gen/%.json
	ts-node scripts/js/src/validate_schema.ts $^ $@

gen/types/%.d.ts: gen/%.schema.json
	mkdir -p gen/types
	json2ts $< > $@

gen/mapDetails.lua: gen/map_list.validated.json gen/types/map_list.d.ts 
	ts-node scripts/js/src/gen_map_details_lua.ts $@

all: gen/map_list.validated.json gen/mapDetails.lua

check_listed_maps_exist: gen/map_list.validated.json gen/types/map_list.d.ts
	ts-node scripts/js/src/check_maps_exist.ts $<

test: check_listed_maps_exist
	echo ok

types: gen/types/map_list.d.ts gen/map_list.schema.json

update_all_from_rowy: gen/map_list.schema.json
	ts-node scripts/js/src/update_from_rowy.ts map_list.yaml all

clean:
	rm -rf gen/*

.PHONY: clean test check_listed_maps_exist types update_all_from_rowy
