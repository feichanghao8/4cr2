#include "Patcher.hpp"

#include <format>

namespace patcher {
namespace {
// Locate the {begin,end} of a function of the form:
// function <NAME>(...) {...}
//                      ^   ^
static std::pair<size_t, size_t> FindExplicitFunctionBody(
	std::string_view haystack,
	std::string_view function
)
{
	const size_t definition = haystack.find(std::format("function {}(", function));
	if (definition == decltype(haystack)::npos)
		return {};

	size_t begin {definition}, end {definition};
	bool foundBegin {false}; // Have we found the opening curly braces?

	// Assuming every { is paired with a }... find the end of the function definition.
	for (size_t depth {}; end < haystack.size() && !(foundBegin && depth == 0); ++end)
	{
		if (haystack[end] == '{')
		{
			if (!std::exchange(foundBegin, true))
				begin = end;
	
			depth++;
		}
		else if (haystack[end] == '}')
		{
			depth--;
		}
	}

	if (end == haystack.size())
		return {};

	return std::make_pair(begin, end);
}
}  // namespace

std::string_view Apply(std::string &file, const std::span<const Descriptor> &descs)
{
	for (const Descriptor &desc : descs)
	{
		switch (desc.type)
		{
		case Type::ReplaceOne:
		{
			const size_t pos = file.find(desc.token);
			if (pos == std::string::npos)
				return desc.token;

			file.replace(pos, desc.token.size(), desc.replacement);
			break;
		}
		case Type::ExplicitFunction:
		{
			const auto [begin, end] = FindExplicitFunctionBody(file, desc.token);
			if (!begin || !end)
				return desc.token;

			file.replace(begin, end - begin, desc.replacement);
			break;
		}
		}
	}

	return {};
}
}  // namespace patcher
