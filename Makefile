gen/%.json: %.yaml
	python scripts/py/yaml_to_json.py $< $@

gen/%.validated.json: gen/%.schema.json gen/%.json
	ts-node scripts/js/src/validate_schema.ts $^ $@

gen/types/%.d.ts: gen/%.schema.json
	mkdir -p gen/types
	json2ts $< > $@

all: gen/map_list.validated.json

check_listed_maps_exist: gen/map_list.validated.json gen/types/map_list.d.ts
	ts-node scripts/js/src/check_maps_exist.ts $<

test: check_listed_maps_exist
	echo ok

clean:
	rm -rf gen/*

.PHONY: clean test check_listed_maps_exist
