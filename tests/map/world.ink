=== function _world() ===
~ return get_map() == "main"


=== world_start ===
#once
#desc: The Beginning
#loc: east
This is the starting point of your adventure, in the East house. #id:world_world_start_MH94
-> DONE


=== function _world_bar() ===
~ return world_start
=== world_bar ===
#desc: A Night in the Bar
#loc: bar
You can always have another drink. (Repeating storylet!) #id:world_world_bar_UFTB
+ [Have a drink... #id:world_world_bar_229I]
    (drinking noise) Mmm, lovely. #id:world_world_bar_PHZR
+ [Not this time... #id:world_world_bar_3IHA]
    See you next time, buddy!J #id:world_world_bar_189B
-
-> DONE


=== function _world_library() ===
~ return world_start and not am_wizard
=== world_library ===
#desc: Read the Magic Book
#loc: library
Do you want to read the magic book? #id:world_world_library_UKIV
+ [Yes. #id:world_world_library_LZTP]
    Congratulations, you're a wizard! #id:world_world_library_PXZZ
    We've unlocked so much more to do! (Unlocked wizard storylets.) #id:world_world_library_UN1A
    ~ am_wizard = true
+ [No. #id:world_world_library_WXBR]
    Never mind. But you can always come back here and read it later. (Repeating storylet.) #id:world_world_library_B2L3
-
-> DONE