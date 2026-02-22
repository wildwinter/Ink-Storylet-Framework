// Map-test storylets for the Ink Storylet Framework.
// Demonstrates group predicates, #loc tags, #desc tags, and #once.
//
// Three pools: main (town map), cave (cave map), wizard (unlocked by reading magic book).
// Group predicates _main(), _cave(), _wizard() gate each pool based on map/state.
// External functions set_map() and get_map() are bound in JavaScript.

#storylets:main,main
#storylets:cave,cave
#storylets:wizard,wizard

EXTERNAL set_map(map_name)
=== function set_map(map_name) ===
~ return

EXTERNAL get_map()
=== function get_map() ===
~ return "main"

// -----------------------------------------------------------------------
// Group predicates — evaluated once per refresh before any individual
// storylet predicates in the group are checked.
// -----------------------------------------------------------------------

=== function _main() ===
~ return get_map() == "main"

=== function _cave() ===
~ return get_map() == "cave"

VAR am_wizard = false

=== function _wizard() ===
// Wizard storylets are available on any map, once the player is a wizard.
~ return am_wizard


// -----------------------------------------------------------------------
// Main storylets (town map)
// -----------------------------------------------------------------------

=== function _main_start() ===
~ return true

=== main_start ===
#once
#desc: The Beginning
#loc: east
This is the starting point of your adventure, in the East house.
-> DONE


=== function _main_bar() ===
// Available after the intro has played (Ink knot visit count > 0).
~ return main_start

=== main_bar ===
#desc: A Night in the Bar
#loc: bar
You can always have another drink. (Repeating storylet!)
+ [Have a drink...]
    (drinking noise) Mmm, lovely.
+ [Not this time...]
    See you next time, buddy!
-
-> DONE


=== function _main_library() ===
~ return main_start and not am_wizard

=== main_library ===
#desc: Read the Magic Book
#loc: library
Do you want to read the magic book?
+ [Yes.]
    Congratulations, you're a wizard!
    We've unlocked so much more to do! (Unlocked wizard storylets.)
    ~ am_wizard = true
+ [No.]
    Never mind. But you can always come back here and read it later. (Repeating storylet.)
-
-> DONE


// -----------------------------------------------------------------------
// Cave storylets
// -----------------------------------------------------------------------

=== function _cave_exit() ===
~ return true

=== cave_exit ===
#desc: Leave the cave
#loc: exit
+ [Leave the cave.]
    ~ set_map("main")
-
You go back into the world.
-> DONE


=== function _cave_well() ===
~ return true

=== cave_well ===
#desc: Examine the well
#loc: well
The well is dry.
-> DONE


// -----------------------------------------------------------------------
// Wizard storylets (available on any map once am_wizard is true)
// -----------------------------------------------------------------------

=== function _wizard_visit_library() ===
~ return true

=== wizard_visit_library ===
#once
#desc: Read the Wizard Library Shelves
#loc: library
Now you're a wizard, you can read what's on the library shelves!
Let's say you've read them all. No need to come back again.
-> DONE


=== function _wizard_cave() ===
~ return true

=== wizard_cave ===
#desc: Search the Magic Cave
#loc: cave
This is the magic cave, which only wizards can search!
+ [Go into the cave.]
    ~ set_map("cave")
-
You go into the cave.
-> DONE


=== function _wizard_home_wizard() ===
~ return true

=== wizard_home_wizard ===
#once
#desc: A Visit Back Home
#loc: east
Home looks different now you're a wizard.
-> DONE
