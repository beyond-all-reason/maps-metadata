gen/%.json: %.yaml
	python scripts/py/yaml_to_json.py $< $@

gen/%.validated.json: gen/%.schema.json gen/%.json
	deno run --allow-write --allow-read scripts/js/validate_schema.ts $^ $@

all: gen/map_list.validated.json

test:
	echo ok

clean:
	rm -rf gen/*

.PHONY: clean test
