#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <span>

namespace patcher {
enum class Type: uint32_t
{
	// Finds and replaces one occurence in a file.
	ReplaceOne,
	// Replaces the entire definition of a function matching the form:
	// function <NAME>(...) { ... }
	ExplicitFunction,
};

// Describes a patch in a file.
struct Descriptor
{
	Type type {};

	// How these are used depends on type.
	std::string_view token {}, replacement {};
};

// Apply a set of patches to a file in-memory.
// Returns an empty string_view on success, and the string view of the token
// that first failed, otherwise.
std::string_view Apply(std::string &file, const std::span<const Descriptor> &descs);
}  // namespace patcher
