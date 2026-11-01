# Preserve retrieved law through context limits

Status: accepted; lossless context reuse is described in ADR0047.

Legal chat retains returned retrieval results and complete read provisions throughout the request; count, text-size and model-context limits must not silently discard them or turn unexamined material into irrelevant law. Research may select evidence by legal relevance and merge duplicate identities without losing their source associations, but crossing a processing limit does not establish sufficient Official Coverage.

This supersedes ADR0011's fixed character/source ceilings as grounds for excluding retrieved evidence. Exact source text and identities remain available even when a provider operation cannot contain all retained material; how to continue or report incomplete processing must remain explicit. This decision does not enlarge a provider context window, authorize unlimited searches or spending, or change the existing delivery deadlines by implication. Corpus trust, complete provisions, private-data boundaries and admitted operating resources remain in force.
