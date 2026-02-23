=== function _cave() ===
~ return get_map() == "cave"


=== cave_exit ===
#desc: Leave the cave
#loc: exit
+ [Leave the cave. #id:cave_cave_exit_K6CR]
    ~ set_map("main")
-
You go back into the world. #id:cave_cave_exit_148F
-> DONE


=== cave_well ===
#desc: Examine the well
#loc: well
The well is dry. #id:cave_cave_well_EFZ9
-> DONE