gen/%.json: %.yaml
	python scripts/py/yaml_to_json.py $< $@

gen/%.validated.json: gen/%.schema.json gen/%.json
	deno run --allow-write --allow-read scripts/js/validate_schema.ts $^ $@

gen/%.d.ts: gen/%.schema.json
	deno run --allow-read npm:json-schema-to-typescript@12.0.0 $< > $@

all: gen/map_list.validated.json

check_listed_maps_exist: gen/map_list.validated.json gen/map_list.d.ts
	deno run --allow-read --allow-net scripts/js/check_maps_exist.ts $<

test: check_listed_maps_exist
	echo ok

clean:
	rm -rf gen/*

.PHONY: clean test check_listed_maps_exist
