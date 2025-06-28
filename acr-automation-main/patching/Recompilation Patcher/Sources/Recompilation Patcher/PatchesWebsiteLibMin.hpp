#pragma once
#include "Patcher/Patcher.hpp"

#include <array>

static constexpr std::array<patcher::Descriptor, 1> kPatchesWebsiteLibMin
{
	patcher::Descriptor {patcher::Type::ReplaceOne,
	"socket=io.connect(c,b);",
	"b.query+=`&realurl=${c}`;socket=io.connect(\"http://localhost:2020\",b);"
	},

	//patcher::Descriptor {patcher::Type::ReplaceOne,
	//"var r=avroCoreHub.decode(q);",
	//"var r=avroCoreHub.decode(q);socket.emit(\"avro\", JSON.stringify(r));"
	//},
};
