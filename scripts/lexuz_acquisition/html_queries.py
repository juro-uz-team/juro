"""Ordered lookup over an unchanged publisher tree, without repeated root scans."""
from collections import defaultdict


class HtmlIndex:
    def __init__(self, soup):
        self.tags = soup.find_all(True)
        self.names, self.ids, self.class_names = (defaultdict(list) for _ in range(3))
        for node in self.tags:
            self.names[node.name].append(node)
            if 'id' in node.attrs:
                self.ids[node['id']].append(node)
            for name in set(node.get('class', [])):
                self.class_names[name].append(node)

    def first_id(self, value):
        return next(iter(self.ids.get(value, ())), None)

    def first_name(self, value):
        return next(iter(self.names.get(value, ())), None)

    def classes(self, *values):
        if len(values) == 1:
            return self.class_names.get(values[0], ())
        wanted = set(values)
        return [node for node in self.tags if wanted.intersection(node.get('class', []))]

    def first_class(self, *values):
        return next(iter(self.classes(*values)), None)

    def children(self, identity, name):
        # Duplicate IDs remain visible, just as the publisher's CSS queries did.
        return [node for node in self.names.get(name, ())
                if node.parent.get('id') == identity]

    def descendants(self, identity, name):
        return [node for node in self.names.get(name, ())
                if any(parent.get('id') == identity for parent in node.parents)]
