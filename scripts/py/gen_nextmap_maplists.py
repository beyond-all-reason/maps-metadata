# Generates maplists for https://github.com/beyond-all-reason/spads_config_bar/blob/main/etc/mapLists.conf . This controls the !nextmap command in spads.

import json
import math

teamsizes = ['2v2','3v3','4v4','5v5','6v6','7v7','8v8']
ffasizes = ['ffa3','ffa4','ffa5','ffa6','ffa7','ffa8','ffa9','ffa10','ffa11','ffa12','ffa13','ffa14','ffa15','ffa16']
teamffasizes = ['2v2v2','2v2v2v2','2v2v2v2v2','2v2v2v2v2v2','2v2v2v2v2v2v2','2v2v2v2v2v2v2v2','3v3v3','3v3v3v3','3v3v3v3v3','4v4v4','4v4v4v4','5v5v5']
#output_string = ''

def get_data(input_file):
    with open(input_file) as f:
        contents = json.load(f)
    
    teamsize_dict = {}
    ffasize_dict = {}
    teamffasize_dict = {}
    certified_maps = []
    uncertified_maps = []
    maps_1v1 = []
  
    for i in teamsizes:
        teamsize_dict[i] = []
    for i in ffasizes:
        ffasize_dict[i] = []
    for i in teamffasizes:
        teamffasize_dict[i] = []
    
    for i in contents:
        if not contents[i]["inPool"]:
            continue
        isTeam = False
        isFfa = False
        is1v1 = False
        mapname = ''
        playerCount = 0

        if "springName" in contents[i].keys():
            mapname = contents[i]["springName"]
        if "gameType" in contents[i].keys() and "team" in contents[i]["gameType"]:
            isTeam = True
        if "gameType" in contents[i].keys() and "ffa" in contents[i]["gameType"]:
            isFfa = True
        if "gameType" in contents[i].keys() and "1v1" in contents[i]["gameType"]:
            is1v1 = True
        if "playerCount" in contents[i].keys():
            playerCount = contents[i]["playerCount"]
        #32 player ffa or other such sillyness not supported in !nextmap
        if playerCount > 16:
            playerCount = 16

        if "startboxesSet" in contents[i].keys():
            for j in contents[i]["startboxesSet"]:
                if "maxPlayersPerStartbox" in contents[i]["startboxesSet"][j].keys():
                    numberOfTeams = 0
                    for k in contents[i]["startboxesSet"][j]["startboxes"]:
                        numberOfTeams = numberOfTeams + 1
                    maxPlayersPerStartbox = contents[i]["startboxesSet"][j]["maxPlayersPerStartbox"]

                    # add maps to teamsize_dict
                    if numberOfTeams == 2:
                        x = 0
                        for l in teamsize_dict:
                            if x + 2 <= maxPlayersPerStartbox and x + 2 >= math.floor(maxPlayersPerStartbox/2):
                                teamsize_dict[l].append(mapname)
                            x = x + 1
                    
                    # add maps to teamffasize_dict:
                    if numberOfTeams == 3:
                        if maxPlayersPerStartbox >= 2:
                            teamffasize_dict['2v2v2'].append(mapname)
                        if maxPlayersPerStartbox >= 3:
                            teamffasize_dict['3v3v3'].append(mapname)
                        if maxPlayersPerStartbox >=4:
                            teamffasize_dict['4v4v4'].append(mapname)
                        if maxPlayersPerStartbox >=5:
                            teamffasize_dict['5v5v5'].append(mapname)
                    if numberOfTeams == 4:
                        if maxPlayersPerStartbox >= 2:
                            teamffasize_dict['2v2v2v2'].append(mapname)
                        if maxPlayersPerStartbox >= 3:
                            teamffasize_dict['3v3v3v3'].append(mapname)
                        if maxPlayersPerStartbox >=4:
                            teamffasize_dict['4v4v4v4'].append(mapname)
                    if numberOfTeams == 5:
                        if maxPlayersPerStartbox >= 2:
                            teamffasize_dict['2v2v2v2v2'].append(mapname)
                        if maxPlayersPerStartbox >= 3:
                            teamffasize_dict['3v3v3v3v3'].append(mapname)
                    if numberOfTeams == 6:
                        if maxPlayersPerStartbox >= 2:
                            teamffasize_dict['2v2v2v2v2v2'].append(mapname)
                    if numberOfTeams == 7:
                        if maxPlayersPerStartbox >= 2:
                            teamffasize_dict['2v2v2v2v2v2v2'].append(mapname)
                    if numberOfTeams == 8:
                        if maxPlayersPerStartbox >= 2:
                            teamffasize_dict['2v2v2v2v2v2v2v2'].append(mapname)

                # if a map didn't have "maxPlayersPerStartbox" set for its startboxes, but it's a teamgame map with startboxes for 2 teams, we'll use playerCount instead:
                if not "maxPlayersPerStartbox" in contents[i]["startboxesSet"][j].keys() and playerCount and isTeam:
                    numberOfTeams = 0
                    for k in contents[i]["startboxesSet"][j]["startboxes"]:
                        numberOfTeams = numberOfTeams + 1
                    if numberOfTeams == 2:
                        x = 0
                        for l in teamsize_dict:
                            if x + 2 <= math.floor(playerCount/2) and x + 2 >= math.floor(playerCount/4):
                                teamsize_dict[l].append(mapname)
                            x = x + 1
        
        # add maps to ffasize_dict
        if isFfa:
            x = 0
            for j in ffasize_dict:
                if x + 3 <= playerCount and x + 3 >= math.floor(playerCount/2):
                    ffasize_dict[j].append(mapname)
                x = x + 1
                    
        # add maps to certified and uncertified lists
        if contents[i]["certified"] == True:
            certified_maps.append(mapname)
        else:
            uncertified_maps.append(mapname)
        
        #add maps to 1v1 list
        if is1v1:
            maps_1v1.append(mapname)


    combined_dict = {**teamsize_dict,**ffasize_dict,**teamffasize_dict}
    
    return combined_dict, certified_maps, uncertified_maps, maps_1v1

def get_output_string(combined_dict, certified_maps, uncertified_maps, maps_1v1):
    output_string = """# This file was automatically generated by https://github.com/beyond-all-reason/maps-metadata/tree/main/scripts/py/gen_nextmap_maplists.py using data from rowy.
# Next update from rowy will overwrite this file so do not manually edit this file.
# If you want to make updates to this see https://github.com/beyond-all-reason/maps-metadata/wiki/Adding-a-created-map-to-the-game.
# A map needs properly configured playercount, startboxes and maxPlayersPerStartbox in https://rowy.beyondallreason.dev/table/maps to appear here.
# For example a 2v2v2v2 map needs a startbox configuration with 4 startboxes and maxPlayersPerStartbox >= 2.
[all]
.*

[certified]
"""
    for i in certified_maps:
        output_string = output_string + i + '\n'

    output_string = output_string + '\n[uncertified]\n'
    for i in uncertified_maps:
        output_string = output_string + i + '\n'
    output_string = output_string + '\n[1v1]\n'

    for i in maps_1v1:
        output_string = output_string + i + '\n'
    output_string = output_string + '\n'
    
    for i in combined_dict:
        output_string = output_string + '[' + i + ']\n'
        for j in combined_dict[i]:
            output_string = output_string + j + '\n'
        output_string = output_string + '\n'
    
    return output_string

def process(input_file,output_file):
    combined_dict, certified_maps, uncertified_maps, maps_1v1 = get_data(input_file)
    output = get_output_string(combined_dict, certified_maps, uncertified_maps, maps_1v1)
    with open(output_file, "w") as f:
        f.write(output)

if __name__ == '__main__':
    input_file = './gen/map_list.validated.json'
    output_file = './gen/mapLists.conf'
    process(input_file, output_file)
