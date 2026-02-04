// Note that this var could be altered
// in Ink or by a binding to the game
// state in Unity.
VAR at_war_with_trolls = false

=== function _story_troll_ambassador() ===
~ return not at_war_with_trolls
=== story_troll_ambassador ===
You meet a troll. They are extremely polite, offer their hopes 
for longstanding peace, and offer you golden chocolates. 
You insult their hospitality, and start a war.
~ at_war_with_trolls = true
-> DONE

=== function _story_troll_deserter() ===
~ return at_war_with_trolls
=== story_troll_deserter ===
You meet a troll. They claim to have escaped from persecution 
in the Troll Army, and ask for sanctuary.
-> DONE

=== function _story_rainy_day() ===
~ return true
=== story_rainy_day ===
#once
It's a surprisingly rainy day, the sort of day that only happens 
once a century.
-> DONE

=== function _story_sing() ===
~ return true
=== story_sing ===
You sing a silly song, just to pass the time.
-> DONE