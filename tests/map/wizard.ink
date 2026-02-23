VAR am_wizard = false

=== function _wizard() ===
~ return am_wizard


=== wizard_visit_library ===
#once
#desc: Read the Wizard Library Shelves
#loc: library
Now you're a wizard, you can read what's on the library shelves! #id:wizard_wizard_visit_library_NUDE
Let's say you've read them all. No need to come back again. #id:wizard_wizard_visit_library_BDLP
-> DONE


=== wizard_cave ===
#desc: Search the Magic Cave
#loc: cave
This is the magic cave, which only wizards can search! #id:wizard_wizard_cave_4UG8
+ [Go into the cave. #id:wizard_wizard_cave_H522]
    ~ set_map("cave")
-
You go into the cave. #id:wizard_wizard_cave_L0YD
-> DONE


=== wizard_home_wizard ===
#once
#desc: A Visit Back Home
#loc: east
Home looks different now you're a wizard. #id:wizard_wizard_home_wizard_BT02
-> DONE