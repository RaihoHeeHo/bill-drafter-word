# AKN-NY profile validator (version 0.3)

A copy of the validator from LBDC's AKN-NY profile: the official Akoma Ntoso 3.0 schema (`schema/akn`), LBDC's
metadata extension (`schema/lbdc-akn.xsd`) and the New York profile rules (`rules/ny-akn-profile.sch`). The add-in's
tests run it on the XML the add-in writes.

    python3 profile/validate.py bill.akn.xml      # needs lxml (pip install lxml)

The profile itself (specification, examples, real-bill tests and tools) is kept with LBDC's clean-copy demo; replace
these files when it changes.
